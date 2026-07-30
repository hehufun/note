function corsify(resp) {
  var headers = new Headers(resp.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: headers,
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsify(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const rawSid = url.pathname.slice(1);
    const rawPath = url.searchParams.get("p");

    if (rawPath === null) {
      return corsify(new Response("missing path", { status: 400 }));
    }

    // url.pathname 保留百分号编码 → 需要 decodeURIComponent
    // url.searchParams.get("p") 已自动解码 → 直接用
    const sid = decodeURIComponent(rawSid);
    const pagePath = rawPath;
    const key = sid + "::" + pagePath;

    if (request.method === "PUT") {
      const body = await request.arrayBuffer();
      await env.SYNC.put(key, body);
      return corsify(new Response("ok", { status: 200 }));
    }

    if (request.method === "GET") {
      const data = await env.SYNC.get(key, "arrayBuffer");
      if (!data) {
        return corsify(new Response("not found", { status: 404 }));
      }
      return corsify(
        new Response(data, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
    }

    return corsify(new Response("method not allowed", { status: 405 }));
  },
};
