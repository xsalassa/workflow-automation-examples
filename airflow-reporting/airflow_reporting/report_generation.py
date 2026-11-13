# update 4 feb 2026
from datetime import datetime, timedelta
from google.cloud import storage
from airflow.operators.dummy_operator import DummyOperator
from airflow.providers.google.cloud.operators.bigquery import (
    BigQueryInsertJobOperator
)
from airflow.operators.python_operator import BranchPythonOperator
from airflow_reporting.script.export_data import extract_data
from airflow_reporting.script.waiting_until_jobs_done import _waiting_until_jobs_done
from airflow import DAG
from airflow.exceptions import AirflowSkipException
from airflow.models import Variable
from airflow.models.param import Param
from airflow.utils.task_group import TaskGroup
from airflow.operators.python import PythonOperator
from airflow_reporting.notification_adapters import _pubsub
from airflow_reporting.notification_adapters import _email
import hashlib
import pendulum
import json
import os

script_dir  = os.path.dirname(__file__)
local_tz    = pendulum.timezone("Asia/Jakarta")

# Load default global config
ENV             = Variable.get("ENVIRONMENT")
OPS_TASK_DIR    = Variable.get("REPORT_SQL_DIRECTORY")

# Load environment config
abs_file_path       = os.path.join(script_dir, f"config/config_{ENV}.json")
config_json         = json.load(open(abs_file_path))
config_env          = config_json["env"]
PROJECT_ID          = config_env["project_id"]
SSH_CONN_ID         = config_env["ssh_conn_id"]
GCS_BUCKET          = config_env["gcs_bucket"]
GCS_FOLDER          = config_env["gcs_folder"]
BQ_DATASET_TMP      = config_env["bq_tmp_dataset"]
BQ_DATASET_OPS      = config_env["bq_ops_dataset"]
BQ_DATASET_DW       = config_env["bq_dw_dataset"]
SOURCE_DATASET      = config_env["source_dataset"]
SOURCE_TABLES       = config_env["source_tables"]
TARGET_TABLES       = config_env["target_tables"]
BQ_OPS_TABLE        = config_env["bq_ops_table"]
S3_BUCKET           = config_env["s3_bucket"]
GEN_PUBSUB_TOPIC    = config_env["gen_pubsub_topic"]
GEN_RPT_TABLE       = config_env["gen_rpt_table"]
AWS_CONN_ID         = config_env["aws_conn_id"]

# Define dag constants
config_dag          = config_json["dag"]
JOB_NAME            = config_dag["job_name"]
yesterday_dttm      = datetime.utcnow() + timedelta(hours=7) - timedelta(days=1)
yesterday_dt        = yesterday_dttm.strftime("%Y-%m-%d")
# parse the date string back to a datetime object so we can format timestamps and fractions safely
yesterday_datetime  = f"{yesterday_dttm.strftime('%Y-%m-%dT%H%M%S')}.{yesterday_dttm.strftime('%f')[:3]}Z"
month_folder        = yesterday_dttm.strftime("%m %b").upper()
year_folder         = yesterday_dttm.strftime("%Y")
month_period        = (datetime.utcnow() + timedelta(hours=7)).strftime("%Y%m")
today_dt            = (datetime.utcnow() + timedelta(hours=7)).strftime("%Y-%m-%d")

# Branches included in all partner reports. Update this list when the scope changes.
PARTNER_BRANCH_CODES = ["B001", "B002"]
PARTNER_BRANCH_CODES_SQL = ", ".join(
    f"'{branch_code}'" for branch_code in PARTNER_BRANCH_CODES
)


REPORTS = [
    {"name"     : "dataset_01",
     "sql_file" : "dataset_01.sql",
     "filename" : "dataset_01"},
    {"name"     : "dataset_02",
     "sql_file" : "dataset_02.sql",
     "filename" : "dataset_02"},
    {"name"     : "dataset_03",
     "sql_file" : "dataset_03.sql",
     "filename" : "dataset_03"},
    {"name"     : "dataset_04",
    "sql_file"  : "dataset_04.sql",
    "filename"  : "dataset_04"},
    {"name"     : "dataset_05",
    "sql_file"  : "dataset_05.sql",
    "filename"  : "dataset_05"},
    {"name"     : "dataset_06",
    "sql_file"  : "dataset_06.sql",
    "filename"  : "dataset_06"},
    {"name"     : "dataset_07",
    "sql_file"  : "dataset_07.sql",
    "filename"  : "dataset_07"},
    {"name"     : "dataset_08",
    "sql_file"  : "dataset_08.sql",
    "filename"  : "dataset_08"},
]


GROUP_1 = ["dataset_01",
            "dataset_02",
            "dataset_04",
            "dataset_05",
            ]
GROUP_2 = ["dataset_06",
            "dataset_07",
            "dataset_03",
            "dataset_08"
            ]

SKIPPABLE_TASK_IDS = [
    "waiting_until_jobs_done",
    "waiting_jobs_done",
    *[
        task_id
        for report in REPORTS
        for task_id in (
            f"rpt_partner_{report['name']}.create_rpt_partner_{report['name']}",
            f"rpt_partner_{report['name']}.export_data_partner_{report['name']}",
        )
    ],
    "generate_manifest",
]

# Define dag config
OWNER           = config_dag["owner"]
EMAIL           = config_dag["email"]
TAGS            = config_dag["tags"]
SCHEDULE        = config_dag["schedule"]

# Define pubsub config
config_pubsub       = config_json["pubsub"]
PUBSUB_PROJECT_ID   = config_pubsub["pubsub_project_id"]
TOPIC               = config_pubsub["topic"]
PROJECT_NAME        = TAGS[0]
MESSAGE_LENGTH      = config_pubsub["message_length"]

#Define DAG Docs
DESCRIPTION = (
    """##DAG docs for """
    + JOB_NAME
    + """

#### Available config

1. **rpt_date**   : report date **(string, date format (YYYY-MM-DD))**
2. **skip_<task_id>** [checkbox] : Select the tasks going to be skipped. <br> default: false <br>

#### Date logic

```text
Transactional data date : rpt_date - 1 day
GCS output               : REPORTS/YYYYMM/rpt_date/
```

#### Example

```json
{"rpt_date": "2026-09-12"}
```

```text
Transactional data date : 2026-09-11
GCS output               : REPORTS/202609/2026-09-12/
```
"""
)



# Define custom macro to get job_id_bq
def job_id_bq(execution_date: pendulum.DateTime) -> str:
    dt_object = datetime.fromtimestamp(execution_date.timestamp(), tz=local_tz)
    job_id = dt_object.strftime("%Y%m%d%H%M%S")
    job_id_formatted  = f"{dt_object.strftime('%Y-%m-%dT%H%M%S')}.{dt_object.strftime('%f')[:3]}Z"
    return job_id, job_id_formatted

# Define function to generate sha1 checksum for GCS files
def sha1_stream_gcs(blob):
    sha1 = hashlib.sha1()
    with blob.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            sha1.update(chunk)
    return sha1.hexdigest()

# Define function to generate manifest file
def generate_manifest(**context):
    execute_date = context['dag_run'].conf.get('rpt_date', today_dt)

    storage_client  = storage.Client()
    blobs_list      = storage_client.list_blobs(
            bucket_or_name=f"{GCS_BUCKET}",
            prefix=f'{GCS_FOLDER}/{month_period}/{execute_date}/',
        )

    lines = []

    for blob in blobs_list:
        if blob.name.endswith(".csv"):
            checksum = sha1_stream_gcs(blob)
            filename = os.path.basename(blob.name)
            lines.append(f"{filename} SHA1 {checksum}")

    manifest = "\n".join(lines)

    # Upload manifest file to GCS
    bucket = storage_client.bucket(GCS_BUCKET)
    manifest_blob = bucket.blob(f'{GCS_FOLDER}/{month_period}/{execute_date}/manifest_4')
    manifest_blob.upload_from_string(
        manifest,
        content_type="text/plain"
    )

    print("Manifest uploaded!")
    print(manifest)

# Define what airflow do when a task is fail
def on_failure_callback(context):
    JOB_ID      = job_id_bq(context.get("execution_date"))[0]
    TASK_ID     = context.get("task_instance").task_id
    EXCEPTION   = context.get("exception")
    LOG_URL     = context.get("task_instance").log_url

    pubsub_failed = PythonOperator(
        task_id = "pubsub_failed",
        python_callable = _pubsub,
        op_kwargs = {
            "PUBSUB_PROJECT_ID" : PUBSUB_PROJECT_ID,
            "TOPIC"             : TOPIC,
            "JOB_NAME"          : JOB_NAME,
            "STATUS"            : "FAILED",
            "PROJECT_NAME"      : PROJECT_NAME,
            "ENV"               : ENV,
            "JOB_ID"            : JOB_ID,
            "EXCEPTION"         : "Error on : " + str(TASK_ID) + " : " + str(EXCEPTION),
            "MESSAGE_LENGTH"    : MESSAGE_LENGTH,
        },
    )
    pubsub_failed.execute(dict())

    email_failed = PythonOperator(
        task_id="email_failed",
        python_callable=_email,
        op_kwargs={
            "PROJECT_ID"    : PROJECT_ID,
            "PROJECT_NAME"  : PROJECT_NAME,
            "ENV"           : ENV,
            "JOB_NAME"      : JOB_NAME,
            "SOURCE_TABLE"  : BQ_OPS_TABLE,
            "JOB_ID"        : JOB_ID,
            "STATUS"        : "Failed",
            "TASK_ID"       : TASK_ID,
            "EXCEPTION"     : EXCEPTION,
            "LOG_URL"       : LOG_URL,
            "EMAIL"         : EMAIL,
            },
    )
    email_failed.execute(dict())

# Define pre_execute
def skip_if_specified(context):
    task_id = context['task_instance'].task_id
    conf = context["dag_run"].conf or {}
    params = context.get("params", {})
    skip_tasks = conf.get("skip_tasks", [])
    if isinstance(skip_tasks, str):
        skip_tasks = [skip_tasks]
    if not skip_tasks:
        skip_tasks = [
            task_id
            for task_id in SKIPPABLE_TASK_IDS
            if conf.get(f"skip_{task_id}", params.get(f"skip_{task_id}", False))
        ]
    if task_id in skip_tasks:
        raise AirflowSkipException(f"{task_id} is skipped.")

# Define default arguments
default_args = {
    "owner"                 : OWNER,
    "depends_on_past"       : False,
    "email_on_failure"      : False,
    "email_on_retry"        : False,
    "email"                 : EMAIL,
    "retries"               : 3,
    "retry_delay"           : timedelta(minutes=5),
    "pre_execute"           : skip_if_specified,
    "trigger_rule"          : "none_failed",
    "on_failure_callback"   : on_failure_callback
}

# Define dag
with DAG(
    JOB_NAME,
    access_control          ={f"{TAGS[0]}-ops": {"can_read", "can_edit"}},
    start_date              =datetime(2025, 11, 24, tzinfo=local_tz),
    schedule_interval       =SCHEDULE,
    concurrency             =5,
    max_active_runs         =1,
    default_args            =default_args,
    tags                    =TAGS,
    template_searchpath     =[OPS_TASK_DIR],
    catchup                 =False,
    is_paused_upon_creation =True,
    params                  ={
        "rpt_date": Param(
            default=today_dt,
            type="string",
            format="date",
            title="Report date",
            description="Tanggal periode report partner.",
        ),
        **{
            f"skip_{task_id}": Param(
                default=False,
                type="boolean",
                title=f"Skip {task_id}",
                description="Centang untuk melewati task ini.",
            )
            for task_id in SKIPPABLE_TASK_IDS
        },
    },
    user_defined_macros     ={
        "job_id_bq"     : job_id_bq
        },
) as dag:

    dag.doc_md = __doc__
    dag.doc_md = DESCRIPTION


    start = DummyOperator(
        task_id="start",
    )

    waiting_until_jobs_done = BranchPythonOperator(
        task_id="waiting_until_jobs_done",
        python_callable=_waiting_until_jobs_done,
        provide_context=True,
        op_kwargs={
            "PROJECT_ID"        : PROJECT_ID,
            "SOURCE_DATASET"    : BQ_DATASET_OPS,
            "SOURCE_TABLE"      : BQ_OPS_TABLE
        },
    )

    waiting_jobs_done = DummyOperator(
        task_id         = "waiting_jobs_done"
    )


    report_tasks = {}
    for report in REPORTS:
        report_name = report["name"]

        with TaskGroup(f"rpt_partner_{report_name}") as task_group:
            create_task = BigQueryInsertJobOperator(
                task_id         = f"create_rpt_partner_{report_name}",
                project_id      = PROJECT_ID,
                configuration   = {
                    "query": {
                        "query"         : "{% include './sql/" + report["sql_file"] + "' %}",
                        "useLegacySql"  : False,
                    }
                },
                params={
                    "project_id"        : PROJECT_ID,
                    "target_dataset"    : BQ_DATASET_TMP,
                    "period"            : today_dt,
                    "branch_codes"      : PARTNER_BRANCH_CODES_SQL,
                    "target_table"      : TARGET_TABLES[report_name],
                    "source_dataset"    : SOURCE_DATASET,
                    "source_tables"     : SOURCE_TABLES
                },
            )

            export_task = PythonOperator(
                task_id = f"export_data_partner_{report_name}",
                python_callable = extract_data,
                op_kwargs = {
                    "source_table": TARGET_TABLES[report_name],
                    "project_id": PROJECT_ID,
                    "bucket": GCS_BUCKET,
                    "dest_folder": f'{GCS_FOLDER}/{month_period}/{{{{ dag_run.conf.get("rpt_date", "{today_dt}") }}}}',
                    "filename": report["filename"]
                },
            )

            create_task >> export_task

        report_tasks[report_name] = task_group

    generate_manifest = PythonOperator(
        task_id = "generate_manifest",
        python_callable = generate_manifest,
        provide_context=True,
    )

    end = DummyOperator(
        task_id = "end",
    )


    group_1_tasks = [report_tasks[name] for name in GROUP_1]
    group_2_tasks = [report_tasks[name] for name in GROUP_2]

    def chain_tasks_sequentially(tasks):
        if not tasks:
            return
        for i in range(len(tasks) - 1):
            tasks[i] >> tasks[i + 1]

    # Chain tasks within each group sequentially
    chain_tasks_sequentially(group_1_tasks)
    chain_tasks_sequentially(group_2_tasks)

    start >> waiting_until_jobs_done >> waiting_jobs_done

    # Both groups start from waiting_jobs_done in parallel
    waiting_jobs_done >> group_1_tasks[0]
    waiting_jobs_done >> group_2_tasks[0]

    # generate_manifest waits for BOTH groups to finish
    group_1_tasks[-1] >> generate_manifest
    group_2_tasks[-1] >> generate_manifest

    # end waits for manifest
    generate_manifest >> end
