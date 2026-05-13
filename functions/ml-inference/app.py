def handler(event, context):
    return {
        "ok": True,
        "op": event.get("op"),
        "message": "dummy ml-inference alive"
    }
