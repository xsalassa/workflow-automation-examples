import csv
import io
import uuid

from google.api_core.exceptions import BadRequest
from google.cloud import bigquery, storage


# Cloud Storage accepts at most 32 source objects in one compose request.
GCS_COMPOSE_MAX_SOURCES = 32


def compose_csv_shards(
    bq_client,
    table_id,
    bucket_name,
    dest_folder,
    filename,
):
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    shard_prefix = f"{dest_folder}/{filename}-"
    compose_prefix = f"{dest_folder}/.{filename}-compose-"

    shard_blobs = sorted(
        (
            blob
            for blob in storage_client.list_blobs(
                bucket_name,
                prefix=shard_prefix,
            )
            if blob.name.endswith(".csv")
        ),
        key=lambda blob: blob.name,
    )
    if not shard_blobs:
        raise RuntimeError(f"No CSV shards found with prefix: {shard_prefix}")

    run_token = uuid.uuid4().hex
    temporary_blobs = []

    header_buffer = io.StringIO()
    csv.writer(
        header_buffer,
        delimiter="|",
        lineterminator="\n",
    ).writerow(field.name for field in bq_client.get_table(table_id).schema)

    header_blob = bucket.blob(
        f"{compose_prefix}{run_token}-header.csv"
    )
    header_blob.upload_from_string(
        header_buffer.getvalue(),
        content_type="text/csv",
    )
    temporary_blobs.append(header_blob)

    compose_sources = [header_blob, *shard_blobs]
    compose_level = 0

    try:
        while len(compose_sources) > GCS_COMPOSE_MAX_SOURCES:
            next_level_sources = []
            for group_number, start in enumerate(
                range(0, len(compose_sources), GCS_COMPOSE_MAX_SOURCES)
            ):
                source_group = compose_sources[
                    start:start + GCS_COMPOSE_MAX_SOURCES
                ]
                if len(source_group) == 1:
                    next_level_sources.extend(source_group)
                    continue

                intermediate_blob = bucket.blob(
                    f"{compose_prefix}{run_token}-"
                    f"{compose_level}-{group_number}.csv"
                )
                intermediate_blob.content_type = "text/csv"
                intermediate_blob.compose(source_group)
                temporary_blobs.append(intermediate_blob)
                next_level_sources.append(intermediate_blob)

            compose_sources = next_level_sources
            compose_level += 1

        destination_blob = bucket.blob(f"{dest_folder}/{filename}.csv")
        destination_blob.content_type = "text/csv"
        destination_blob.compose(compose_sources)
    except Exception:
        for blob in reversed(temporary_blobs):
            try:
                blob.delete()
            except Exception as cleanup_exc:
                print(
                    f"Could not delete temporary object {blob.name}: "
                    f"{cleanup_exc}"
                )
        raise

    for blob in [*shard_blobs, *reversed(temporary_blobs)]:
        blob.delete()

    print(
        f"Combined {len(shard_blobs)} shard(s) into: "
        f"gs://{bucket_name}/{destination_blob.name}"
    )


def delete_previous_shards(bucket_name, dest_folder, filename):
    storage_client = storage.Client()
    prefixes = (
        f"{dest_folder}/{filename}-",
        f"{dest_folder}/.{filename}-compose-",
    )
    for prefix in prefixes:
        for blob in storage_client.list_blobs(bucket_name, prefix=prefix):
            if blob.name.endswith(".csv"):
                blob.delete()


def extract_data(source_table, project_id, bucket, dest_folder, filename):
    bq_client = bigquery.Client()

    table_id = f"{project_id}.tmp.{source_table}"
    destination_uri = f"gs://{bucket}/{dest_folder}/{filename}.csv"

    extract_job_config = bigquery.ExtractJobConfig(
        destination_format="CSV",
        field_delimiter="|",
        print_header=True
    )

    print("Starting extract job...")

    extract_job = bq_client.extract_table(
        table_id,
        destination_uri,
        job_config=extract_job_config
    )

    try:
        extract_job.result()  # wait for completion
    except BadRequest as exc:
        error_message = str(exc).lower()
        if "too large to be exported to a single file" not in error_message:
            raise

        destination_uri = f"gs://{bucket}/{dest_folder}/{filename}-*.csv"
        delete_previous_shards(bucket, dest_folder, filename)
        print(
            "Table is too large for one file; retrying the extract with "
            f"sharded destination: {destination_uri}"
        )
        sharded_extract_job_config = bigquery.ExtractJobConfig(
            destination_format="CSV",
            field_delimiter="|",
            print_header=False
        )
        extract_job = bq_client.extract_table(
            table_id,
            destination_uri,
            job_config=sharded_extract_job_config
        )
        extract_job.result()
        compose_csv_shards(
            bq_client=bq_client,
            table_id=table_id,
            bucket_name=bucket,
            dest_folder=dest_folder,
            filename=filename,
        )
        destination_uri = f"gs://{bucket}/{dest_folder}/{filename}.csv"

    print("Extract job completed!")
    print(f"File saved to: {destination_uri}")
