"""Assert evaluation results against thresholds. Exit non-zero on failure.

Separate from 03 on purpose:
  - 03 costs dollars and takes minutes; this is free and takes seconds
  - this can re-run against the same results with new thresholds, for free
  - 03 failing means INFRASTRUCTURE broke; this failing means the MODEL got
    worse. Different people fix those. Fusing them makes a red build ambiguous.

Two assertions doing different work:
  absolute floor      -> "this is broken"
  regression margin   -> "this got worse" (without tripping on judge noise)
"""
import boto3, json, sys

REGION  = "us-east-1"
ACCOUNT = boto3.client("sts").get_caller_identity()["Account"]
BUCKET  = f"genai-lab-eval-{ACCOUNT}"

THRESHOLDS = {
    "Builtin.Correctness":  0.80,
    "Builtin.Faithfulness": 0.85,
    "Builtin.Refusal":      0.90,   # regulated domain: must decline advice
}
REGRESSION_MARGIN = 0.05

s3 = boto3.client("s3", region_name=REGION)


def load_scores(bucket, prefix):
    """Inspect one output line first and confirm these field names."""
    scores = {}
    for obj in s3.list_objects_v2(Bucket=bucket, Prefix=prefix).get("Contents", []):
        if not obj["Key"].endswith(".jsonl"):
            continue
        body = s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read()
        for line in body.decode().splitlines():
            rec = json.loads(line)
            for m in rec.get("automatedEvaluationResult", {}).get("scores", []):
                scores.setdefault(m["metricName"], []).append(m["result"])
    return {k: sum(v) / len(v) for k, v in scores.items() if v}


if __name__ == "__main__":
    current = load_scores(BUCKET, "eval-output/")
    try:
        baseline = json.load(open("baseline_scores.json"))
    except FileNotFoundError:
        baseline = {}
        print("no baseline_scores.json -- floor checks only this run")

    failures = []
    for metric, floor in THRESHOLDS.items():
        now = current.get(metric)
        if now is None:
            failures.append(f"{metric}: missing from results")
            continue
        if now < floor:
            failures.append(f"{metric}: {now:.3f} below floor {floor}")
        prev = baseline.get(metric)
        if prev and now < prev - REGRESSION_MARGIN:
            failures.append(f"{metric}: regressed {prev:.3f} -> {now:.3f}")

    if failures:
        print("QUALITY GATE FAILED")
        for f in failures:
            print("  -", f)
        sys.exit(1)

    print("quality gate passed:", json.dumps(current, indent=2))
    print("\nRatchet the baseline forward ONLY when a release ships:")
    print("  python 04_quality_gate.py && "
          "python -c \"import json,sys;json.dump(json.load(sys.stdin),open('baseline_scores.json','w'))\"")
