import boto3, time, json, statistics
from botocore.config import Config

REGION = "us-east-1"
brt = boto3.client(
    "bedrock-runtime",
    config=Config(region_name=REGION, retries={"max_attempts": 3, "mode": "adaptive"}),
)

# Verified by invocation on 2026-08-27 against account 635474720027.
MODELS = {
    "nova-micro": "us.amazon.nova-micro-v1:0",
    "nova-lite": "us.amazon.nova-lite-v1:0",
    "haiku-4.5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
}

# USD per 1M tokens (input, output). CHECK aws.amazon.com/bedrock/pricing --
# these change and are the only numbers here you should not trust blindly.
PRICES = {
    "nova-micro": (0.035, 0.14),
    "nova-lite": (0.06, 0.24),
    "haiku-4.5": (1.00, 5.00),
}

PROMPTS = [
    "What is a 401(k) retirement plan? Answer in two sentences.",
    "Explain the difference between a Roth IRA and a traditional IRA.",
    "What does APR mean on a credit card, and how does it differ from APY?",
    "A customer asks whether they should move their savings into equities. Respond appropriately.",
    "Summarize what FDIC insurance covers and what it does not cover.",
]


def ask(model_id, prompt, max_tokens=1024):
    """One code path for every provider. This is the whole point."""
    t0 = time.perf_counter()
    r = brt.converse(
        modelId=model_id,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2},
    )
    latency = time.perf_counter() - t0
    return {
        "text": r["output"]["message"]["content"][0]["text"],
        "in_tok": r["usage"]["inputTokens"],  # real counts, from the API
        "out_tok": r["usage"]["outputTokens"],
        "latency": latency,
        "stop": r["stopReason"],
    }


def cost(name, in_tok, out_tok):
    pin, pout = PRICES[name]
    return (in_tok / 1_000_000 * pin) + (out_tok / 1_000_000 * pout)


if __name__ == "__main__":
    rows = []
    for name, model_id in MODELS.items():
        for prompt in PROMPTS:
            try:
                r = ask(model_id, prompt)
                rows.append(
                    {
                        "model": name,
                        "prompt": prompt[:40],
                        "latency": round(r["latency"], 3),
                        "in_tok": r["in_tok"],
                        "out_tok": r["out_tok"],
                        "usd": round(cost(name, r["in_tok"], r["out_tok"]), 6),
                        "truncated": r["stop"] == "max_tokens",
                        "text": r["text"],
                    }
                )
                print(f"  {name:<12} {r['latency']:.2f}s  {r['out_tok']:>4} out")
            except Exception as e:
                print(f"  {name:<12} FAILED: {type(e).__name__}: {e}")

    print("\n=== Summary ===")
    for name in MODELS:
        rs = [r for r in rows if r["model"] == name]
        if not rs:
            continue
        lats = sorted(r["latency"] for r in rs)
        p50 = statistics.median(lats)
        p95 = lats[max(0, int(len(lats) * 0.95) - 1)]
        total = sum(r["usd"] for r in rs)
        trunc = sum(r["truncated"] for r in rs)
        print(
            f"{name:<12} p50 {p50:.2f}s  p95 {p95:.2f}s  "
            f"${total:.5f} for {len(rs)} calls  truncated={trunc}"
        )
        print(f"{'':<12} ${total / len(rs) * 1000:.2f} per 1,000 requests")

    with open("benchmark_results.json", "w") as f:
        json.dump(rows, f, indent=2)
