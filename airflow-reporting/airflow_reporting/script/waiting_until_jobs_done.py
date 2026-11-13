from google.cloud import bigquery
from datetime import datetime
import pendulum
import time

def get_total_rows_table(client, PROJECT_ID, SOURCE_DATASET, SOURCE_TABLE):
    local_tz = pendulum.timezone("Asia/Jakarta")
    JOB_ID = datetime.fromtimestamp(datetime.today().timestamp(), tz=local_tz).strftime("%Y%m%d%H%M%S")
    query = f"""
        select count(distinct job_name) as count_rows
        from `{PROJECT_ID}.{SOURCE_DATASET}.{SOURCE_TABLE}`
        where job_name in (
            "upstream_daily_summary"
        )
            and job_date = PARSE_DATE('%Y%m%d', substr(CAST({JOB_ID} as string),1,8))
            and status = 'SUCCESS'
        """
    print(query)
    results = client.query(query)
    rows    = results.result()
    for row in rows:
        count_rows = row["count_rows"]
    return count_rows

# Define custom waiting awaited job to wait reports until its ready to send to telegram
def _waiting_until_jobs_done(
    PROJECT_ID,
    SOURCE_DATASET,
    SOURCE_TABLE
):

    # init client
    client = bigquery.Client()

    stop_retry = False
    x = 0
    while stop_retry == False:
        count_rows = get_total_rows_table(client, PROJECT_ID, SOURCE_DATASET, SOURCE_TABLE)
        if count_rows == 1:
            stop_retry = True
            return "waiting_jobs_done"
        else:
            x+=1
            if x == 12:
                stop_retry = True
                raise Exception("Waiting until jobs done warning: Maximum retries reached.")
            else:
                time.sleep(300)
