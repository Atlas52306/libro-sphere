import html from '../src/public/dash/index.html'
import upload from '../src/public/dash/upload.html'
import list from '../src/public/dash/list.html'
import notfoundpage from '../src/public/dash/404.html'
import { corsHeaders, securityHeaders, is_authorized } from './utils'
import { dumpCache, handleDeleteFile, handleFileList, handleGetFile, handleMultipleUploads, handlePutFile } from './handlers'

const AUTH_REALM = 'LibroSphere';
const MAX_REQUESTS_PER_MINUTE = 60; // 速率限制：每分钟最大请求数

// 简单的内存请求计数器（在生产环境中应使用 KV 或 Durable Objects）
const requestCounts = new Map();

function handleStaticAssets(path) {
	// 处理 HTML 页面
	switch (path) {
		case "/":
			return {
				content: html,
				contentType: 'text/html; charset=utf-8'
			};
		case "/web/upload":
			return {
				content: upload,
				contentType: 'text/html; charset=utf-8'
			};
		case "/web/list":
			return {
				content: list,
				contentType: 'text/html; charset=utf-8'
			};
		case "/web":
			return {
				content: html,
				contentType: 'text/html; charset=utf-8'
			};
		default:
			return {
				content: notfoundpage,
				contentType: 'text/html; charset=utf-8'
			};
	}
}

// 简单的速率限制函数
function checkRateLimit(ip) {
	const now = Date.now();
	const minute = Math.floor(now / 60000); // 当前分钟
	const key = `${ip}:${minute}`;
	
	const count = requestCounts.get(key) || 0;
	
	if (count >= MAX_REQUESTS_PER_MINUTE) {
		return false; // 超过限制
	}
	
	requestCounts.set(key, count + 1);
	
	// 清理旧记录（保持 Map 大小可控）
	if (requestCounts.size > 1000) {
		const oldMinute = minute - 1;
		for (const [key] of requestCounts) {
			if (key.endsWith(`:${oldMinute}`)) {
				requestCounts.delete(key);
			}
		}
	}
	
	return true; // 未超过限制
}

export default {
	async fetch(request, env, ctx) {
		try {
			const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
			
			// 速率限制检查
			if (!checkRateLimit(clientIP)) {
				return new Response("Too many requests", { 
					status: 429, 
					headers: {
						...corsHeaders,
						"Retry-After": "60"
					}
				});
			}
			
			const authorization_header = request.headers.get("Authorization") || "";
			const url = new URL(request.url);
			let path = url.pathname;
			
			// 处理 OPTIONS 请求（WebDAV 预检请求）
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: {
						...corsHeaders,
						"Allow": "GET, PUT, DELETE, PROPFIND, OPTIONS, MKCOL, MOVE, COPY",
						"DAV": "1, 2"
					}
				});
			}

			// 处理favicon请求，不需要鉴权
			if (request.method === "GET" && path === "/favicon.ico") {
				// 返回一个空响应，避免错误
				return new Response(null, {
					status: 204,
					headers: {
						"Cache-Control": "public, max-age=604800"
					}
				});
			}

			// 对于所有其他请求，需要进行身份验证
			if (
				request.method !== "OPTIONS" &&
				!(await is_authorized(authorization_header, env.USERNAME, env.PASSWORD))
			) {
				return new Response("Unauthorized", {
					status: 401,
					headers: {
						"WWW-Authenticate": `Basic realm="${AUTH_REALM}"`,
					},
				});
			}

			// 鉴权通过后处理静态资源
			if (request.method === "GET" && (path === "/" || path.startsWith("/web"))) {
				const { content, contentType } = handleStaticAssets(path);
				
				// 添加 CORS 头和安全头，允许样式文件被跨域访问
				const headers = {
					"Content-Type": contentType,
					"Cache-Control": "public, max-age=604800",
					"Access-Control-Allow-Origin": "*",
					...securityHeaders
				};
				
				return new Response(content, { headers });
			}

			if (request.method === "GET" && path === "/dumpcache") {
				return dumpCache(request, env, ctx);
			}

			if (request.method === "PUT") {
				return handlePutFile(request, env, ctx);
			}

			if (request.method === 'DELETE') {
				return handleDeleteFile(request, env, ctx);
			}

			if (request.method === "POST" && path === "/upload") {
				return handleMultipleUploads(request, env, ctx);
			}

			if (request.method === "GET") {
				return handleGetFile(request, env, ctx);
			}

			if (request.method === "PROPFIND") {
				return handleFileList(request, env, ctx);
			}
			
			// 添加对 MKCOL 方法的基本支持（创建目录）
			if (request.method === "MKCOL") {
				// WebDAV 客户端可能会尝试创建目录，但我们的实现不支持目录
				// 返回成功以避免客户端错误，但实际上不做任何事情
				return new Response("Directory created", { status: 201, headers: corsHeaders });
			}

			return new Response("Method not allowed", { status: 405, headers: corsHeaders });
		} catch (error) {
			console.error("Unhandled error:", error.name);
			return new Response("Internal server error", { 
				status: 500, 
				headers: corsHeaders 
			});
		}
	},
};