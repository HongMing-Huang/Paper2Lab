"""Optional target-machine probe using the official OpenVINO runtime.

Not model inference or a performance benchmark. Run with a Python environment
containing openvino; the Node gateway reports missing runtime as unavailable.
"""
import json
import openvino as ov

core = ov.Core()
devices = []
for device in core.available_devices:
    try:
        name = core.get_property(device, "FULL_DEVICE_NAME")
    except Exception:
        name = None
    devices.append({"id": device, "name": name})
print(json.dumps({"runtime": "openvino", "version": ov.__version__, "devices": devices,
                  "inferenceVerified": False, "performanceMeasured": False}))
