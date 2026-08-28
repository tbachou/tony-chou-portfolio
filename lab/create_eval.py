"""Submit an LLM-as-a-judge evaluation job.

Run your FIRST job from the console (Bedrock > Evaluations) -- fewer moving
parts, and you get the score histograms. Once that succeeds, this reproduces
it as code.

This is the SUBMISSION half only. It asserts nothing.
04_quality_gate.py is the half that gates.

For CI: delete the polling loop at the bottom. Submit and exit; let
EventBridge fire the gate when the job state changes.

COST: roughly $0.50-$3 per run. Keep to 20 prompts and a cheap judge.
"""
import boto3, json, time

REGION  = "us-east-1"
ACCOUNT = boto3.client("sts").get_caller_identity()["Account"]
BUCKET  = f"genai-lab-eval-{ACCOUNT}"
ROLE    = f"arn:aws:iam::{ACCOUNT}:role/BedrockEvalLabRole"

GEN_MODEL   = "us.amazon.nova-lite-v1:0"
JUDGE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

bedrock = boto3.client("bedrock", region_name=REGION)

job = bedrock.create_evaluation_job(
    jobName=f"fin-qa-judge-{int(time.time())}",
    roleArn=ROLE,
    applicationType="ModelEvaluation",
    evaluationConfig={
        "automated": {
            "datasetMetricConfigs": [{
                "taskType": "General",
                "dataset": {
                    "name": "FinQA",
                    "datasetLocation": {"s3Uri": f"s3://{BUCKET}/eval-input/fin_qa.jsonl"},
                },
                "metricNames": [
                    "Builtin.Correctness",
                    "Builtin.Completeness",
                    "Builtin.Faithfulness",
                    "Builtin.Refusal",
                ],
            }],
            "evaluatorModelConfig": {
                "bedrockEvaluatorModels": [{"modelIdentifier": JUDGE_MODEL}]
            },
        }
    },
    inferenceConfig={
        "models": [{
            "bedrockModel": {
                "modelIdentifier": GEN_MODEL,
                "inferenceParams": json.dumps({"temperature": 0.2, "maxTokens": 512}),
            }
        }]
    },
    outputDataConfig={"s3Uri": f"s3://{BUCKET}/eval-output/"},
)

arn = job["jobArn"]
print("submitted:", arn)

# Lab convenience only. Delete this loop for CI.
while True:
    status = bedrock.get_evaluation_job(jobIdentifier=arn)["status"]
    print("status:", status)
    if status in ("Completed", "Failed", "Stopped"):
        break
    time.sleep(30)
