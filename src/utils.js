export const mimeTypes = {
	// Text & Books
	epub: "application/epub+zip",
	pdf: "application/pdf",
	mobi: "application/x-mobipocket-ebook",
	cbr: "application/x-cbr", // Comic Book RAR
	cbz: "application/x-cbz", // Comic Book ZIP
	txt: "text/plain", // Plain text files

	// Fallback
	default: "application/octet-stream",
};

export const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "PUT, GET, PROPFIND, OPTIONS, DELETE, MKCOL, MOVE, COPY, PROPPATCH, HEAD",
	"Access-Control-Allow-Headers": "Authorization, Depth, Content-Type, Destination, Overwrite",
};

export const securityHeaders = {
	"Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; img-src 'self' data:; font-src 'self' https://cdnjs.cloudflare.com;",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "strict-origin-when-cross-origin"
};

export async function is_authorized(authorization_header, username, password) {
	if (!authorization_header || !authorization_header.startsWith("Basic ")) {
		return false;
	}
	
	const encoder = new TextEncoder();
	const expected = encoder.encode(`Basic ${btoa(`${username}:${password}`)}`);
	const header = encoder.encode(authorization_header);
	
	// 创建固定长度的缓冲区，避免长度信息泄露
	const maxLen = Math.max(expected.byteLength, header.byteLength);
	const safeHeader = new Uint8Array(maxLen);
	const safeExpected = new Uint8Array(maxLen);
	
	safeHeader.set(header.subarray(0, maxLen));
	safeExpected.set(expected.subarray(0, maxLen));
	
	try {
		return await crypto.subtle.timingSafeEqual(safeHeader, safeExpected);
	} catch (e) {
		return false;
	}
}

// 安全的路径验证函数
export function sanitizePath(path) {
	// 移除所有前导和尾随斜杠
	path = path.replace(/^\/+|\/+$/g, "");
	// 检查路径遍历尝试
	if (path.includes("..") || path.includes("./") || path.includes("/.")) {
		return null;
	}
	
	// 允许更广泛的字符集，包括中文、日文、韩文等Unicode字符，以及常见符号
	// 只禁止危险字符如 < > : " | ? * 和控制字符
	if (/[<>:"|?*\x00-\x1F]/.test(path)) {
		return null;
	}
	
	return path;
}

// 简单的文件头验证
export function validateFileContent(extension, data) {
	// 只检查常见文件类型，如果需要可以扩展
	if (data.byteLength < 8) return true; // 文件太小，跳过验证
	
	const firstBytes = new Uint8Array(data.slice(0, 8));
	
	switch(extension.toLowerCase()) {
		case 'pdf':
			// PDF 头部应该以 %PDF- 开头
			return firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && 
				   firstBytes[2] === 0x44 && firstBytes[3] === 0x46;
		default:
			return true; // 对于其他类型，默认通过
	}
}