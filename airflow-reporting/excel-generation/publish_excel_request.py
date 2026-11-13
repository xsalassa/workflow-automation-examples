from google.cloud import bigquery
from google.cloud import pubsub_v1
import sys
import time
import json

def publish_message(publisher, filename, data, project_id, pubsub_topic):
    error = ""
    try:
        data_json = json.dumps(data, ensure_ascii=False).encode('utf8')
        topic_path = publisher.topic_path(project_id, pubsub_topic)
        future = publisher.publish(topic_path, data=data_json)
        message_id = future.result()

    except Exception as e:
        error = "Error publishing {} : {}".format(filename, str(e))
        print(error)

    return error

## Define custom waiting awaited job to wait reports until its ready to send to telegram
def _publish_message_pubsub_gen_report(
    PROJECT_ID,
    PUBSUB_TOPIC,
    SOURCE_TABLE,
    BUCKET
):

    project_id = PROJECT_ID
    pubsub_topic = PUBSUB_TOPIC
    source_table = SOURCE_TABLE
    bucket = BUCKET

    client = bigquery.Client(project=project_id)
    publisher = pubsub_v1.PublisherClient()

    query_job = client.query(
    """
        select report_type, table, filters, format, filename, attachment_folder
        from `{0}`.{1}
    """.format(project_id, source_table)
    )

    results = query_job.result()  # Waits for job to complete.

    list_data = []
    for row in results:
        tmp_data = {}
        for key, value in row.items():
            if key in ('report_type', 'table', 'filters', 'format', 'filename', 'attachment_folder'):
                tmp_data[key] = value
        list_data.append(tmp_data)

    error = ""

    if len(list_data) > 0:
        for i in range(0, len(list_data)):
            data = {
                "Report_type": list_data[i]['report_type'],
                "Table": list_data[i]['table'],
                "Filter": list_data[i]['filters'],
                "Format": list_data[i]['format'],
                "Target_filename": list_data[i]['filename'],
                "Target_bucket": bucket,
                "Target_folder": list_data[i]['attachment_folder'] + "/",
                "Client_Project_Id": project_id
            }

            error = publish_message(publisher, list_data[i]['filename'], data, project_id, pubsub_topic)
            if error != "":
                x = 0
                while x < 5 and error != "":
                    time.sleep(5)
                    error = publish_message(publisher, list_data[i]['filename'], data, project_id, pubsub_topic)
                    x+=1

                if error != "":
                    print("Failed to publish file {} after retrying 5 times".format(list_data[i]['filename']))
                else:
                    print("Success publish file {}".format(list_data[i]['filename']))
            else:
                print("Success publish file {}".format(list_data[i]['filename']))

    else:
        error = "Returned none from table `{0}`.{1}".format(project_id, source_table)
        print(error)
