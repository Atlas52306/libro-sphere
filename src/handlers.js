import { corsHeaders, mimeTypes, sanitizePath, validateFileContent } from './utils'

export async function handleDeleteFile(request, env, ctx) {
    const url = new URL(request.url);

    const filePath = decodeURIComponent(url.pathname.slice(1)); // Remove leading slash
    const sanitizedPath = sanitizePath(filePath);

    if (!sanitizedPath) {
        return new Response("文件路径无效，请检查文件名是否包含不支持的特殊字符", { status: 400 });
    }

    try {
        await env.MY_BUCKET.delete(sanitizedPath);

        let dir = "/";
        if (sanitizedPath.includes("/")) {
            const idx = sanitizedPath.lastIndexOf("/");
            dir = idx > 0 ? "/" + sanitizedPath.substring(0, idx) : "/";
        }

        const listingUrl = new URL(dir, url.origin).toString();
        const cache = caches.default;
        const cacheKey = new Request(listingUrl, { cf: { cacheTtl: 604800 } });
        ctx.waitUntil(cache.delete(cacheKey));

        return new Response('文件删除成功', { status: 200 });
    } catch (error) {
        console.error("Delete error:", error.name);
        return new Response('文件删除失败，请稍后重试', { status: 500 });
    }
}

export async function handleMultipleUploads(request, env, ctx) {
    try {
        const formData = await request.formData();
        const results = [];

        for (const entry of formData.entries()) {
            const [fieldName, file] = entry;
            if (file instanceof File) {
                const filename = file.name;
                const extension = filename.split(".").pop().toLowerCase();
                const contentType = mimeTypes[extension] || mimeTypes.default;
                const data = await file.arrayBuffer();

                // 安全检查
                const sanitizedFilename = sanitizePath(filename);
                if (!sanitizedFilename) {
                    results.push({ filename, status: "failed", error: "文件名包含不支持的特殊字符" });
                    continue;
                }

                // 验证文件内容
                if (!validateFileContent(extension, data)) {
                    results.push({ filename, status: "failed", error: "文件内容与扩展名不匹配" });
                    continue;
                }

                try {
                    await env.MY_BUCKET.put(sanitizedFilename, data, { httpMetadata: { contentType } });
                    results.push({ sanitizedFilename, status: "success", contentType });

                    const cache = caches.default;
                    const cacheKey = new Request(new URL("/", request.url).toString(), { cf: { cacheTtl: 604800 } });
                    ctx.waitUntil(cache.delete(cacheKey));
                } catch (error) {
                    console.error("Upload error:", error.name);
                    results.push({ filename, status: "failed", error: "存储服务错误，请稍后重试" });
                }
            }
        }

        return new Response(JSON.stringify(results), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Form processing error:", error.name);
        return new Response(JSON.stringify({ error: "处理上传请求失败，请检查文件格式和大小" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
}

export async function handleGetFile(request, env) {
    try {
        let path = new URL(request.url).pathname;
        const filename = decodeURIComponent(path.slice(1));

        if (path === '/') {
            path = '/web';
            return new Response(null, {
                status: 301,
                headers: {
                    "Location": path,
                    "Content-Type": "text/html",
                    "Cache-Control": "public, max-age=604800"
                },
            });
        }

        const sanitizedFilename = sanitizePath(filename);
        if (!sanitizedFilename) {
            return new Response("文件路径无效，请检查文件名是否包含不支持的特殊字符", { status: 400, headers: corsHeaders });
        }

        const file = await env.MY_BUCKET.get(sanitizedFilename);

        if (file === null) {
            return new Response("文件不存在或已被删除", { status: 404, headers: corsHeaders });
        }

        const extension = sanitizedFilename.split(".").pop().toLowerCase();
        const contentType = mimeTypes[extension] || mimeTypes.default;

        return new Response(file.body, {
            headers: {
                ...corsHeaders,
                "Content-Type": contentType,
                "Content-Disposition": `inline; filename="${encodeURIComponent(sanitizedFilename)}"`,
            },
        });
    } catch (error) {
        console.error("Get file error:", error.name);
        return new Response("获取文件失败，请稍后重试", { status: 500, headers: corsHeaders });
    }
}

export async function handlePutFile(request, env, ctx) {
    try {
        const url = new URL(request.url);
        let filePath = decodeURIComponent(url.pathname);

        const sanitizedPath = sanitizePath(filePath);
        if (!sanitizedPath) {
            return new Response("文件路径无效，请检查文件名是否包含不支持的特殊字符", { status: 400 });
        }

        // Read the file data from the request body
        const data = await request.arrayBuffer();
        const extension = sanitizedPath.split(".").pop().toLowerCase();
        const contentType = mimeTypes[extension] || "application/octet-stream"; // Fallback MIME type

        // 验证文件内容
        if (!validateFileContent(extension, data)) {
            return new Response("文件内容与扩展名不匹配", { status: 400 });
        }

        // Upload the file to R2 with the given filePath as the key
        await env.MY_BUCKET.put(sanitizedPath, data, { httpMetadata: { contentType } });

        // Invalidate cache (ensure cache deletion works)
        const cache = caches.default;
        const listingUrl = new URL("/", request.url).toString();
        const cacheKey = new Request(listingUrl);
        ctx.waitUntil(cache.delete(cacheKey));

        return new Response("文件上传成功", { status: 200 });
    } catch (error) {
        console.error("Upload error:", error.name);
        return new Response("文件上传失败，请稍后重试", { status: 500 });
    }
}

export async function handleFileList(request, env, ctx) {
    try {
        // Handle directory listing (WebDAV-specific)
        const path = new URL(request.url).pathname;
        const prefix = path === "/" ? "" : path.slice(1); // Handle root path

        // 安全检查
        if (prefix && !sanitizePath(prefix)) {
            return new Response("目录路径无效，请检查是否包含不支持的特殊字符", { status: 400, headers: corsHeaders });
        }

        const bypassCache = false; // 允许使用缓存以提高性能
        const cache = caches.default;
        const cacheKey = new Request(request.url, { cf: { cacheTtl: 604800 } });

        if (!bypassCache) {
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }
        }

        // List objects in R2 with the correct prefix
        const objects = await env.MY_BUCKET.list({ prefix });

        // Generate WebDAV XML response
        const xmlResponse = `
        <D:multistatus xmlns:D="DAV:">
            <D:response>
            <D:href>${path}</D:href>
            <D:propstat>
                <D:prop>
                <D:resourcetype><D:collection/></D:resourcetype>
                <D:displayname>${path === "/" ? "root" : path.split("/").pop()}</D:displayname>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
            </D:propstat>
            </D:response>
            ${objects.objects
            .map(
                (obj) => `
                <D:response>
                    <D:href>/${encodeURIComponent(obj.key)}</D:href>
                    <D:propstat>
                    <D:prop>
                        <D:resourcetype/> <!-- Empty for files -->
                        <D:getcontentlength>${obj.size}</D:getcontentlength>
                        <D:getlastmodified>${new Date(obj.uploaded).toUTCString()}</D:getlastmodified>
                    </D:prop>
                    <D:status>HTTP/1.1 200 OK</D:status>
                    </D:propstat>
                </D:response>
                `
            )
            .join("")}
        </D:multistatus>
        `;

        const response = new Response(xmlResponse, {
            headers: {
                ...corsHeaders,
                "Content-Type": "application/xml",
                "Cache-Control": "public, max-age=3600"
            },
        });

        // 将响应存入缓存
        if (!bypassCache) {
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }

        return response;
    } catch (error) {
        console.error("File list error:", error.name);
        return new Response("获取文件列表失败，请稍后重试", { status: 500, headers: corsHeaders });
    }
}

export async function dumpCache(request, env, ctx) {
    const url = new URL(request.url);
    try {
        const listingUrl = new URL('/', url.origin).toString();
        const cache = caches.default;
        const cacheKey = new Request(listingUrl, { cf: { cacheTtl: 604800 } });
        ctx.waitUntil(cache.delete(cacheKey));
        return new Response('缓存已成功刷新', { status: 200 });
    } catch (error) {
        console.error("Cache dump error:", error.name);
        return new Response('刷新缓存失败，请稍后重试', { status: 500 });
    }
}
