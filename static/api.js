// 页面与 API 由同一个 Cloudflare Worker 提供。
const API_BASE_URL = '/api';
let token = null;

// Token 管理
function setToken(newToken) {
    token = newToken;
    if (newToken) {
        localStorage.setItem('admin_token', newToken);
    } else {
        localStorage.removeItem('admin_token');
    }
}

function getToken() {
    if (!token) {
        token = localStorage.getItem('admin_token');
    }
    return token;
}

// API 请求函数
async function fetchAPI(endpoint, options = {}) {
    const token = getToken();
    if (token) {
        options.headers = {
            ...options.headers,
            'Authorization': `Bearer ${token}`
        };
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'API请求失败');
    }

    return response.json();
}

// API 函数
async function login(password) {
    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '登录失败');
        }

        const data = await response.json();
        if (data.token) {
            setToken(data.token);
        } else {
            throw new Error('登录响应中没有找到 token');
        }
        return data;
    } catch (error) {
        setToken(null);
        throw new Error(error.message || '密码错误');
    }
}

async function fetchGroups() {
    return fetchAPI('/groups');
}

async function fetchLinks() {
    return fetchAPI('/links');
}

async function createGroup(data) {
    return fetchAPI('/groups', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

async function updateGroup(id, data) {
    return fetchAPI(`/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

async function deleteGroup(id) {
    return fetchAPI(`/groups/${id}`, {
        method: 'DELETE'
    });
}

async function reorderGroups(ids) {
    return fetchAPI('/groups/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids })
    });
}

async function createLink(data) {
    return fetchAPI('/links', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

async function updateLink(id, data) {
    return fetchAPI(`/links/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}

async function deleteLink(id) {
    return fetchAPI(`/links/${id}`, {
        method: 'DELETE'
    });
}

async function reorderLinks(groupId, ids) {
    return fetchAPI('/links/reorder', {
        method: 'POST',
        body: JSON.stringify({ group_id: groupId, ids })
    });
}

// 获取网页信息
async function fetchWebInfo(url) {
    return fetchAPI('/fetch-info', {
        method: 'POST',
        body: JSON.stringify({ url })
    });
}
