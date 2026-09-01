/**
 * netlify/functions/board-config.js
 *
 * Stores the TV board roster (and tech photos) in Netlify Blobs.
 *
 *   GET  /api/config               -> { ok:true, techs:[...] }
 *   GET  /api/config?photo=<slug>  -> the image bytes for that tech
 *   POST /api/config               -> save roster / upload a photo (password required)
 *
 * Requires the ADMIN_PASSWORD environment variable in Netlify
 * (Site configuration -> Environment variables). After adding or
 * changing it you must clear cache and redeploy.
 */

const ROSTER_KEY = "roster";

/* Used only until the first save from the admin page */
const DEFAULT_ROSTER = [
  { name: "Brandon Tibbott",   board: "service",   role: "Sewer Specialist",    photo: "photos/brandon.jpg",    pin: false, always: true,  hidden: false },
  { name: "Steve Springer",    board: "service",   role: "",                    photo: "photos/steve.jpg",      pin: false, always: true,  hidden: false },
  { name: "Dalton Jones",      board: "service",   role: "",                    photo: "photos/dalton.jpg",     pin: false, always: true,  hidden: false },
  { name: "Jamison Gruber",    board: "service",   role: "",                    photo: "photos/jamison.jpg",    pin: false, always: true,  hidden: false },
  { name: "William Smith",     board: "service",   role: "",                    photo: "photos/william.jpg",    pin: false, always: true,  hidden: false },
  { name: "Nicholas Rivera",   board: "install",   role: "",                    photo: "photos/nicholas.jpg",   pin: false, always: true,  hidden: false },
  { name: "Dylan Maet",        board: "service",   role: "",                    photo: "photos/dylan.jpg",      pin: false, always: true,  hidden: false },
  { name: "Colton Bennett",    board: "install",   role: "Install Lead",        photo: "photos/colton.jpg",     pin: false, always: true,  hidden: false },
  { name: "Manny Martinez",    board: "install",   role: "Install Tech",        photo: "photos/manny.jpg",      pin: false, always: true,  hidden: false },
  { name: "Jackson Field",     board: "install",   role: "Install Lead",        photo: "photos/jackson.jpg",    pin: false, always: true,  hidden: false },
  { name: "David Solokhin",    board: "install",   role: "Subcontractor",       photo: "photos/david.jpg",      pin: false, always: true,  hidden: false },
  { name: "Danik Pidchenko",   board: "install",   role: "",                    photo: "photos/danik.jpg",      pin: false, always: true,  hidden: false },
  { name: "Andrei Grachev",    board: "install",   role: "",                    photo: "photos/andrei.jpg",     pin: false, always: true,  hidden: false },
  { name: "Zachary Holman",    board: "install",   role: "Install Apprentice",  photo: "photos/Zach.jpg",       pin: false, always: true,  hidden: false },
  { name: "Ryan Kenyon",       board: "install",   role: "",                    photo: "photos/Ryan.jpg",       pin: false, always: true,  hidden: false },
  { name: "Diego Ramos",       board: "install",   role: "",                    photo: "photos/diego.jpg",      pin: false, always: true,  hidden: false },
  { name: "Bart Kephart",      board: "service",   role: "Service Tech",        photo: "",                      pin: false, always: false, hidden: false },
  { name: "Rod Chfat Field",   board: "service",   role: "",                    photo: "",                      pin: false, always: false, hidden: true },
  { name: "Jacksonator-Field Only", board: "service",   role: "",                    photo: "",                      pin: false, always: false, hidden: true },
  { name: "Cody Hobbs",        board: "service",   role: "",                    photo: "",                      pin: false, always: false, hidden: true }
];

/* @netlify/blobs is ESM-only, so load it dynamically from CommonJS */
async function stores() {
  const { getStore } = await import("@netlify/blobs");
  return {
    config: getStore("board-config"),
    photos: getStore("board-photos")
  };
}

const json = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  },
  body: JSON.stringify(body)
});

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

exports.handler = async (event) => {
  try {
    const { config, photos } = await stores();

    /* ---------- serve a stored photo ---------- */
    if (event.httpMethod === "GET" && event.queryStringParameters && event.queryStringParameters.photo) {
      const key = slug(event.queryStringParameters.photo);
      const blob = await photos.get(key, { type: "arrayBuffer" });
      if (!blob) return { statusCode: 404, body: "No photo stored for that name" };
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*"
        },
        body: Buffer.from(blob).toString("base64"),
        isBase64Encoded: true
      };
    }

    /* ---------- read the roster ---------- */
    if (event.httpMethod === "GET") {
      const saved = await config.get(ROSTER_KEY, { type: "json" });
      return json({ ok: true, techs: saved || DEFAULT_ROSTER });
    }

    /* ---------- write ---------- */
    if (event.httpMethod === "POST") {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch (e) {}

      const expected = process.env.ADMIN_PASSWORD;
      if (!expected) return json({ ok: false, error: "ADMIN_PASSWORD isn't set on this site yet." }, 500);
      if (body.password !== expected) return json({ ok: false, error: "Wrong password" }, 401);

      if (body.action === "login") {
        const saved = await config.get(ROSTER_KEY, { type: "json" });
        return json({ ok: true, techs: saved || DEFAULT_ROSTER });
      }

      if (body.action === "save") {
        const techs = (body.techs || [])
          .filter((t) => t && String(t.name || "").trim())
          .map((t) => ({
            name:   String(t.name).trim(),
            board:  String(t.board || "service").toLowerCase(),
            role:   String(t.role || "").trim(),
            photo:  String(t.photo || "").trim(),
            pin:    !!t.pin,
            always: !!t.always,
            hidden: !!t.hidden
          }));
        await config.setJSON(ROSTER_KEY, techs);
        return json({ ok: true, techs });
      }

      if (body.action === "photo") {
        const m = String(body.dataUrl || "").match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
        if (!m) return json({ ok: false, error: "That file wasn't a readable image." }, 400);
        const key = slug(body.name);
        if (!key) return json({ ok: false, error: "Name the person first." }, 400);
        await photos.set(key, Buffer.from(m[1], "base64"));
        return json({ ok: true, url: "/api/config?photo=" + key });
      }

      return json({ ok: false, error: "Unknown action" }, 400);
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
};
