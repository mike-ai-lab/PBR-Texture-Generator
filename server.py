"""
PBR Texture Generator — Flask backend
"""
import os, base64, threading, webbrowser, zipfile, io, json
from flask import Flask, request, jsonify, send_from_directory, send_file, Response
from src.image_processing import process_texture

app = Flask(__name__, static_folder=".", static_url_path="")
ROOT       = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.normpath(os.path.join(ROOT, "output"))
UPLOADS_DIR = os.path.normpath(os.path.join(OUTPUT_DIR, "_uploads"))
os.makedirs(UPLOADS_DIR, exist_ok=True)


@app.route("/")
def index():
    return send_from_directory(ROOT, "app.html")


@app.route("/upload", methods=["POST"])
def upload():
    f = request.files.get("file")
    if not f:
        return jsonify(error="No file"), 400
    dest = os.path.join(UPLOADS_DIR, f.filename)
    f.save(dest)
    return jsonify(path=dest)


def _b64(path):
    with open(path, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()


def _sse(event, data):
    """Format a Server-Sent Event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.route("/generate_stream", methods=["POST"])
def generate_stream():
    """
    SSE endpoint — streams progress events then the final maps.
    Events: progress {step, total, label}, done {maps, mat_name}, error {message}
    """
    data = request.get_json()
    input_path = data.get("path", "").strip()

    def stream():
        if not os.path.isfile(input_path):
            yield _sse("error", {"message": f"File not found: {input_path}"})
            return

        make_seamless = bool(data.get("make_seamless", False))
        total_steps   = 5 if make_seamless else 4
        step          = [0]

        def emit(label):
            step[0] += 1
            return _sse("progress", {"step": step[0], "total": total_steps, "label": label})

        try:
            import cv2
            from src.generators import generate_normal, generate_roughness, generate_ao
            from src.image_processing import _imread_safe
            from src.seamless import make_seamless as _make_seamless

            input_norm = os.path.normpath(os.path.abspath(input_path))
            base       = os.path.splitext(os.path.basename(input_norm))[0]
            mat_dir    = os.path.normpath(os.path.join(OUTPUT_DIR, base))
            os.makedirs(mat_dir, exist_ok=True)

            bgr = _imread_safe(input_norm)

            if make_seamless:
                yield emit("Making seamless…")
                bgr = _make_seamless(bgr, blend_ratio=float(data.get("seamless_blend", 0.25)))

            yield emit("Saving albedo…")
            alb_path = os.path.join(mat_dir, f"{base}_alb.png")
            cv2.imwrite(alb_path, bgr)

            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

            yield emit("Generating normal map…")
            nrm_path = os.path.join(mat_dir, f"{base}_nrm.png")
            cv2.imwrite(nrm_path, generate_normal(gray, float(data.get("normal_strength", 10))))

            yield emit("Generating roughness map…")
            rgh_path = os.path.join(mat_dir, f"{base}_rgh.png")
            cv2.imwrite(rgh_path, generate_roughness(gray, float(data.get("roughness_alpha", 0.8)),
                                                           float(data.get("roughness_beta", 50))))

            yield emit("Generating AO map…")
            ao_path = os.path.join(mat_dir, f"{base}_ao.png")
            cv2.imwrite(ao_path, generate_ao(gray, float(data.get("ao_alpha", 1.5))))

            # All files confirmed written — now encode
            maps = {
                "albedo":    _b64(alb_path),
                "normal":    _b64(nrm_path),
                "roughness": _b64(rgh_path),
                "ao":        _b64(ao_path),
            }
            yield _sse("done", {"maps": maps, "mat_name": base})

        except Exception as e:
            import traceback
            yield _sse("error", {"message": str(e)})

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/download_zip")
def download_zip():
    mat = request.args.get("mat", "").strip()
    # Resolve and validate — prevent path traversal
    mat_dir = os.path.normpath(os.path.join(OUTPUT_DIR, mat))
    out_dir  = os.path.normpath(OUTPUT_DIR)
    if not mat_dir.startswith(out_dir + os.sep) and mat_dir != out_dir:
        return "Not found", 404
    if not os.path.isdir(mat_dir):
        return "Not found", 404

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(mat_dir):
            if fname.lower().endswith(".png"):
                zf.write(os.path.join(mat_dir, fname), fname)
    buf.seek(0)
    return send_file(buf, mimetype="application/zip",
                     as_attachment=True, download_name=f"{mat}_maps.zip")


if __name__ == "__main__":
    threading.Timer(1.2, lambda: webbrowser.open("http://localhost:5199")).start()
    app.run(port=5199, debug=False)
