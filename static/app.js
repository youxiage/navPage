// 搜索引擎配置
const SEARCH_ENGINES = {
    baidu: {
        url: 'https://www.baidu.com/s?wd=',
        label: '百度'
    },
    google: {
        url: 'https://www.google.com/search?q=',
        label: 'Google'
    },
    bing: {
        url: 'https://www.bing.com/search?q=',
        label: 'Bing'
    }
};

let activeSearchEngine = 'baidu';

function escapeHTML(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function safeHttpUrl(value, fallback = '#') {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? escapeHTML(url.href) : fallback;
    } catch {
        return fallback;
    }
}

function normalizeLinkInput(value) {
    const trimmedValue = String(value ?? '').trim();
    if (!trimmedValue) return null;

    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue);
    if (!hasScheme && !trimmedValue.includes('.')) return null;

    try {
        const url = new URL(hasScheme ? trimmedValue : `https://${trimmedValue}`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url.toString();
    } catch {
        return null;
    }
}

// 保存搜索引擎选择
function saveSearchEngine(engine) {
    localStorage.setItem('preferred_search_engine', engine);
}

// 获取保存的搜索引擎
function getSearchEngine() {
    const savedEngine = localStorage.getItem('preferred_search_engine');
    return SEARCH_ENGINES[savedEngine] ? savedEngine : 'baidu';
}

function setSearchEngine(engine) {
    if (!SEARCH_ENGINES[engine]) return;
    activeSearchEngine = engine;
    saveSearchEngine(engine);

    document.querySelectorAll('.search-engine-tab').forEach(button => {
        const isActive = button.dataset.engine === engine;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.placeholder = `使用 ${SEARCH_ENGINES[engine].label} 搜索...`;
        searchInput.focus({ preventScroll: true });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    setSearchEngine(getSearchEngine());

    // 检查并恢复登录状态
    checkLoginStatus();

    initializePage();
});

// 检查登录状态
async function checkLoginStatus() {
    const token = getToken();
    if (token) {
        try {
            const response = await fetch(`${API_BASE_URL}/verify`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                isAdmin = true;
                isEditMode = false;  // 默认不进入编辑模式
                updateAdminButton();
            } else {
                // Token 无效，清除它
                setToken(null);
            }
        } catch (error) {
            console.error('验证token失败:', error);
            setToken(null);
        }
    }
}

async function initializePage() {
    await loadNavigation();
}

// 添加编辑模式状态
let isAdmin = false;
let isEditMode = false;

// 更新管理员按钮状态
function updateAdminButton() {
    const adminButton = document.getElementById('adminButton');
    if (isAdmin) {
        if (isEditMode) {
            adminButton.innerHTML = `
                <button class="admin-button" onclick="exitEditMode()">
                    <i class="fas fa-times"></i> 退出编辑
                </button>
                <button class="admin-button" onclick="handleLogout()">
                    <i class="fas fa-sign-out-alt"></i> 退出登录
                </button>
            `;
        } else {
            adminButton.innerHTML = `
                <button class="admin-button" onclick="enterEditMode()">
                    <i class="fas fa-edit"></i> 编辑
                </button>
                <button class="admin-button" onclick="handleLogout()">
                    <i class="fas fa-sign-out-alt"></i> 退出登录
                </button>
            `;
        }
    } else {
        adminButton.innerHTML = `
            <button class="admin-button" onclick="openAdminModal()">
                <i class="fas fa-user-lock"></i> 管理员登录
            </button>
        `;
    }
}

// 进入编辑模式
function enterEditMode() {
    isEditMode = true;
    updateAdminButton();
    loadNavigation();
}

// 退出编辑模式
function exitEditMode() {
    isEditMode = false;
    updateAdminButton();
    loadNavigation();
}

// 退出登录
function handleLogout() {
    setToken(null);
    isAdmin = false;
    isEditMode = false;
    updateAdminButton();
    loadNavigation();
}

// 搜索处理
function handleSearch(event) {
    event.preventDefault();
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();

    if (query) {
        const url = SEARCH_ENGINES[activeSearchEngine].url + encodeURIComponent(query);
        window.open(url, '_blank');
    }
}

// 管理员登录相关
function openAdminModal() {
    document.getElementById('adminModal').style.display = 'block';
}

function closeAdminModal() {
    document.getElementById('adminModal').style.display = 'none';
}

async function handleLogin(event) {
    event.preventDefault();
    const password = document.getElementById('adminPassword').value;

    try {
        await login(password);
        closeAdminModal();
        isAdmin = true;
        updateAdminButton();
        showToast('登录成功');
        await loadNavigation(); // 重新加载导航以显示私密链接
    } catch (error) {
        showToast('登录失败: ' + error.message, 'error');
    }
}

// 链接管理相关
function openLinkModal(linkId = null) {
    if (!isEditMode) {
        showToast('请先登录管理员账号');
        return;
    }

    const modal = document.getElementById('linkModal');
    const form = document.getElementById('linkForm');
    form.reset();

    updateGroupSelect();

    if (linkId) {
        loadLinkData(linkId);
    }

    // 添加 URL 输入框的失焦事件监听
    const urlInput = document.getElementById('linkUrl');
    urlInput.removeEventListener('blur', autoFillLinkInfo); // 先移除旧的监听器
    urlInput.addEventListener('blur', autoFillLinkInfo);

    modal.style.display = 'block';
}

function closeLinkModal() {
    document.getElementById('linkModal').style.display = 'none';
}

async function handleLinkSubmit(event) {
    event.preventDefault();
    const linkId = event.target.dataset.linkId;
    const groupId = parseInt(document.getElementById('linkGroup').value);

    let orderNum;
    if (linkId) {
        // 编辑现有链接
        const links = await fetchLinks();
        const currentLink = links.find(l => l.id === parseInt(linkId));

        if (currentLink && currentLink.group_id !== groupId) {
            // 如果分组发生变化
            try {
                // 处理原分组中的链接序号
                const oldGroupLinks = links
                    .filter(l => l.group_id === currentLink.group_id)
                    .sort((a, b) => a.order_num - b.order_num);

                // 更新原分组中序号大于当前链接的所有链接
                for (let i = 0; i < oldGroupLinks.length; i++) {
                    const link = oldGroupLinks[i];
                    if (link.order_num > currentLink.order_num) {
                        await updateLink(link.id, {
                            ...link,
                            order_num: link.order_num - 1
                        });
                    }
                }

                // 获取新分组的最大序号
                const groupLinks = links.filter(l => l.group_id === groupId);
                groupLinks.sort((a, b) => a.order_num - b.order_num);
                orderNum = groupLinks.length + 1;
            } catch (error) {
                showToast('更新序号失败: ' + error.message, 'error');
                return;
            }
        } else {
            // 如果分组没变，保持原序号
            orderNum = parseInt(event.target.dataset.orderNum) || 0;
        }
    } else {
        // 添加新链接
        try {
            const links = await fetchLinks();
            const groupLinks = links.filter(l => l.group_id === groupId);
            // 找到当前分组中最大的序号
            const maxOrderNum = groupLinks.reduce((max, link) =>
                Math.max(max, link.order_num || 0), 0);
            orderNum = maxOrderNum + 1;
        } catch (error) {
            console.error('获取链接序号失败:', error);
            orderNum = 1; // 如果出错，默认使用1
        }
    }

    const formData = {
        name: document.getElementById('linkName').value,
        url: document.getElementById('linkUrl').value,
        logo: document.getElementById('linkLogo').value,
        description: document.getElementById('linkDescription').value,
        group_id: groupId,
        order_num: orderNum
    };

    try {
        if (linkId) {
            await updateLink(parseInt(linkId), formData);
        } else {
            await createLink(formData);
        }

        closeLinkModal();
        showToast('保存成功');
        await loadNavigation();
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    }
}

// 分组管理相关
function openGroupModal(groupId = null) {
    if (!isEditMode) {
        showToast('请先登录管理员账号');
        return;
    }

    const modal = document.getElementById('groupModal');
    const form = document.getElementById('groupForm');
    form.reset();
    form.dataset.groupId = groupId || '';

    if (groupId) {
        loadGroupData(groupId);
    }

    modal.style.display = 'block';
}

function closeGroupModal() {
    document.getElementById('groupModal').style.display = 'none';
}

async function handleGroupSubmit(event) {
    event.preventDefault();
    const groupId = event.target.dataset.groupId;

    // 获取当前最大序号
    const groups = await fetchGroups();
    const maxOrderNum = Math.max(0, ...groups.map(g => g.order_num || 0));

    const formData = {
        name: document.getElementById('groupName').value,
        is_private: document.getElementById('groupPrivate').checked,
        order_num: groupId ? parseInt(event.target.dataset.orderNum) || 0 : maxOrderNum + 1
    };

    try {
        if (groupId) {
            await updateGroup(groupId, formData);
        } else {
            await createGroup(formData);
        }
        closeGroupModal();
        showToast('分组保存成功');
        await loadNavigation();
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    }
}

// 图标缓存
const iconCache = new Map();

// 获取图标URL并缓存
async function getIconUrl({ url }) {
    try {
        const domain = new URL(url).hostname;
        // 先检查本地缓存
        const cacheKey = `icon_cache_${domain}`;
        const cachedUrl = localStorage.getItem(cacheKey);
        if (cachedUrl) {
            return cachedUrl;
        }

        // 尝试不同的图标服务，按可靠性排序
        const iconUrls = [
            // 使用 Icon Horse 服务（支持 CORS）
            `https://icon.horse/icon/${domain}`,
            // 使用 Favicon Kit（支持 CORS）
            `https://api.faviconkit.com/${domain}/144`,
            // 最后尝试网站自身的图标
            `https://${domain}/favicon.ico`
        ];

        // 依次尝试每个图标源
        for (const iconUrl of iconUrls) {
            try {
                // 直接使用 img 标签测试图标是否可用
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = iconUrl;
                });

                // 如果图片加载成功，缓存并返回URL
                localStorage.setItem(cacheKey, iconUrl);
                return iconUrl;
            }
            catch (error) {
                continue;
            }
        }

        // 如果所有尝试都失败了，返回 null 使用备选图标
        return null;
    } catch (error) {
        return null;
    }
}

// 导航内容加载
async function loadNavigation() {
    const navigationElement = document.getElementById('navigation');
    const groupNavElement = document.getElementById('groupNav');

    // 设置加载状态
    const loadingHtml = `
        <div class="nav-loading">
            <div class="nav-loading-dot"></div>
            <div class="nav-loading-dot"></div>
            <div class="nav-loading-dot"></div>
        </div>
    `;

    navigationElement.innerHTML = `
        <div class="loading">
            <div class="loading-wave">
                <div></div>
                <div></div>
            </div>
            <div>加载中...</div>
        </div>
    `;
    groupNavElement.innerHTML = loadingHtml;

    try {
        const groups = await fetchGroups();
        const links = await fetchLinks();

        let html = '';
        let navHtml = '';

        // 如果是编辑模式，添加管理按钮
        if (isEditMode) {
            html += `
                <div class="admin-controls">
                    <button onclick="openGroupModal()">
                        <i class="fas fa-folder-plus"></i> 添加分组
                    </button>
                    <button onclick="openLinkModal()">
                        <i class="fas fa-link"></i> 添加链接
                    </button>
                </div>
            `;
        }

        // 如果没有数据，显示相应提示
        if (groups.length === 0) {
            navigationElement.innerHTML = html + '暂无内容';
            groupNavElement.innerHTML = '暂无分组';
            return;
        }

        for (const group of groups) {
            if (!group.is_private || isAdmin) {
                const groupLinks = links.filter(link => link.group_id === group.id);
                const groupId = `group-${group.id}`;

                html += `
                    <div id="${groupId}" class="group" data-group-id="${group.id}"
                         ${isEditMode ? 'data-drag-type="group"' : ''}>
                        <div class="group-title" ${isEditMode ? 'title="按住分类标题并拖动排序"' : ''}>
                            ${getGroupTitle(group)}
                            ${getGroupActions(group.id)}
                        </div>
                        <div class="links" data-group-id="${group.id}">
                            ${groupLinks.map(link => getLinkCard(link)).join('')}
                        </div>
                    </div>
                `;

                navHtml += `
                    <a href="#${groupId}"
                       class="nav-item"
                       onclick="highlightNavItem(this)"
                       data-group-id="${groupId}">
                        ${escapeHTML(group.name)}
                        ${group.is_private ?
                            `<i class="fas fa-lock group-privacy-icon" title="私密分组"></i>` : ''
                        }
                    </a>
                `;
            }
        }

        // 更新内容
        navigationElement.innerHTML = html;
        groupNavElement.innerHTML = navHtml;

        initializeDragSorting();

        // 加载图标
        await loadIcons();

        // 监听滚动事件来更新活动项
        window.addEventListener('scroll', updateActiveNavItem);
    } catch (error) {
        // 显示错误信息
        navigationElement.innerHTML = `<div class="error">加载失败: ${escapeHTML(error.message)}</div>`;
        groupNavElement.innerHTML = `<div class="error">加载失败</div>`;
    }
}

// 高亮当前选中的导航项
function highlightNavItem(element) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    element.classList.add('active');
}

// 根据滚动位置更新活动导航项
function updateActiveNavItem() {
    const groups = document.querySelectorAll('.group');
    const navItems = document.querySelectorAll('.nav-item');

    groups.forEach((group, index) => {
        const rect = group.getBoundingClientRect();
        if (rect.top <= 100 && rect.bottom >= 100) {
            highlightNavItem(navItems[index]);
        }
    });
}

// 提示消息
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const safeType = ['success', 'error', 'loading'].includes(type) ? type : 'success';
    toast.className = `toast ${safeType}`;

    let icon = '';
    switch (safeType) {
        case 'success':
            icon = '<i class="fas fa-check-circle"></i>';
            break;
        case 'error':
            icon = '<i class="fas fa-times-circle"></i>';
            break;
        case 'loading':
            icon = '<i class="fas fa-spinner"></i>';
            break;
    }

    toast.innerHTML = icon;
    toast.appendChild(document.createTextNode(String(message)));
    container.appendChild(toast);

    // 3秒后自动移除
    if (safeType !== 'loading') {
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    return toast;
}

// 显示确认对话框
function showConfirm(title, message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirmDialog');
        dialog.querySelector('.confirm-title').textContent = title;
        dialog.querySelector('.confirm-message').textContent = message;
        dialog.style.display = 'block';

        const handleClick = (result) => {
            dialog.style.display = 'none';
            resolve(result);
        };

        dialog.querySelector('.confirm-ok').onclick = () => handleClick(true);
        dialog.querySelector('.confirm-cancel').onclick = () => handleClick(false);
    });
}

// 关闭模态框的其他方式
window.onclick = function(event) {
    const modal = document.getElementById('adminModal');
    if (event.target === modal) {
        closeAdminModal();
    }
}

// 删除分组确认
async function deleteGroupConfirm(groupId) {
    const confirmed = await showConfirm(
        '删除分组',
        '确定要删除这个分组吗？这将同时删除组内的所有链接！'
    );

    if (confirmed) {
        const toast = showToast('正在删除分组...', 'loading');
        try {
            await deleteGroup(groupId);
            toast.remove();
            showToast('分组删除成功');
            await loadNavigation();
        } catch (error) {
            toast.remove();
            showToast('删除失败: ' + error.message, 'error');
        }
    }
}

// 加载分组数据到表单
async function loadGroupData(groupId) {
    try {
        const groups = await fetchGroups();
        const group = groups.find(g => g.id === parseInt(groupId));
        if (group) {
            document.getElementById('groupName').value = group.name;
            document.getElementById('groupPrivate').checked = group.is_private;
            const form = document.getElementById('groupForm');
            form.dataset.groupId = groupId;
            form.dataset.orderNum = group.order_num;
        }
    } catch (error) {
        showToast('加载分组数据失败: ' + error.message, 'error');
    }
}

// 加载链接数据到表单
async function loadLinkData(linkId) {
    try {
        const links = await fetchLinks();
        const link = links.find(l => l.id === linkId);
        if (link) {
            document.getElementById('linkName').value = link.name;
            document.getElementById('linkUrl').value = link.url;
            document.getElementById('linkLogo').value = link.logo || '';
            document.getElementById('linkDescription').value = link.description || '';
            document.getElementById('linkGroup').value = link.group_id;
            document.getElementById('linkForm').dataset.linkId = linkId;
            document.getElementById('linkForm').dataset.orderNum = link.order_num;
        }
    } catch (error) {
        showToast('加载链接数据失败: ' + error.message, 'error');
    }
}

// 更新分组下拉列表
async function updateGroupSelect() {
    const select = document.getElementById('linkGroup');
    try {
        const groups = await fetchGroups();
        select.innerHTML = '<option value="">选择分组...</option>' +
            groups.map(group =>
                `<option value="${group.id}">${escapeHTML(group.name)}</option>`
            ).join('');
    } catch (error) {
        console.error('加载分组列表失败:', error);
    }
}

// 删除链接确认
async function deleteLinkConfirm(linkId) {
    const confirmed = await showConfirm(
        '删除链接',
        '确定要删除这个链接吗？'
    );

    if (confirmed) {
        const toast = showToast('正在删除链接...', 'loading');
        try {
            await deleteLink(linkId);
            toast.remove();
            showToast('链接删除成功');
            await loadNavigation();
        } catch (error) {
            toast.remove();
            showToast('删除失败: ' + error.message, 'error');
        }
    }
}

let pointerSortState = null;
let pointerSortTimer = null;

function initializeDragSorting() {
    const navigation = document.getElementById('navigation');
    navigation.onpointerdown = isEditMode ? handleSortPointerDown : null;
}

function attachPointerSortListeners() {
    document.addEventListener('pointermove', handleSortPointerMove, { passive: false });
    document.addEventListener('pointerup', handleSortPointerUp);
    document.addEventListener('pointercancel', handleSortPointerCancel);
}

function detachPointerSortListeners() {
    document.removeEventListener('pointermove', handleSortPointerMove);
    document.removeEventListener('pointerup', handleSortPointerUp);
    document.removeEventListener('pointercancel', handleSortPointerCancel);
}

function handleSortPointerDown(event) {
    if (event.button !== 0 || event.target.closest('button, input, textarea, select')) return;

    const link = event.target.closest('.link-card[data-drag-type="link"]');
    const groupTitle = event.target.closest('.group[data-drag-type="group"] > .group-title');
    const item = link || groupTitle?.closest('.group');
    if (!item) return;

    const type = link ? 'link' : 'group';
    pointerSortState = {
        type,
        item,
        groupId: type === 'link' ? Number(item.dataset.groupId) : null,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false
    };
    attachPointerSortListeners();
    clearTimeout(pointerSortTimer);
    pointerSortTimer = setTimeout(beginPointerSort, 180);
}

function beginPointerSort() {
    if (!pointerSortState || pointerSortState.active) return;
    pointerSortState.active = true;
    pointerSortState.item.classList.add('dragging');
    document.body.classList.add('sorting-active');
}

function handleSortPointerMove(event) {
    if (!pointerSortState || event.pointerId !== pointerSortState.pointerId) return;

    const movedDistance = Math.hypot(
        event.clientX - pointerSortState.startX,
        event.clientY - pointerSortState.startY
    );
    if (!pointerSortState.active && movedDistance > 6) beginPointerSort();
    if (!pointerSortState.active) return;

    event.preventDefault();
    const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
    if (!pointedElement) return;

    const { type, item, groupId } = pointerSortState;
    if (type === 'group') {
        const navigation = document.getElementById('navigation');
        const groups = [...navigation.querySelectorAll(':scope > .group')].filter(group => group !== item);
        const nextGroup = groups.find(group => {
            const rect = group.getBoundingClientRect();
            return event.clientY < rect.top + rect.height / 2;
        });
        navigation.insertBefore(item, nextGroup || null);
        return;
    }

    const linksContainer = pointedElement.closest('.links');
    if (!linksContainer || Number(linksContainer.dataset.groupId) !== groupId) return;

    const target = pointedElement.closest('.link-card');
    if (!target || target === item) {
        if (!target) linksContainer.appendChild(item);
        return;
    }

    const targetRect = target.getBoundingClientRect();
    const isSameRow = Math.abs(event.clientY - (targetRect.top + targetRect.height / 2)) < targetRect.height / 3;
    const insertBefore = isSameRow
        ? event.clientX < targetRect.left + targetRect.width / 2
        : event.clientY < targetRect.top + targetRect.height / 2;
    linksContainer.insertBefore(item, insertBefore ? target : target.nextSibling);
}

async function handleSortPointerUp(event) {
    if (!pointerSortState || event.pointerId !== pointerSortState.pointerId) return;
    clearTimeout(pointerSortTimer);

    const state = pointerSortState;
    pointerSortState = null;
    detachPointerSortListeners();
    if (!state.active) return;

    event.preventDefault();
    event.stopPropagation();
    state.item.addEventListener('click', suppressClickAfterSort, { capture: true, once: true });
    state.item.classList.remove('dragging');
    document.body.classList.remove('sorting-active');
    const toast = showToast('正在保存排序...', 'loading');

    try {
        if (state.type === 'group') {
            const ids = [...document.querySelectorAll('#navigation > .group')].map(group => Number(group.dataset.groupId));
            await reorderGroups(ids);
        } else {
            const linksContainer = document.querySelector(`.links[data-group-id="${state.groupId}"]`);
            const ids = [...linksContainer.querySelectorAll('.link-card')].map(link => Number(link.dataset.linkId));
            await reorderLinks(state.groupId, ids);
        }
        toast.remove();
        showToast('排序已保存');
        await loadNavigation();
    } catch (error) {
        toast.remove();
        showToast('保存排序失败: ' + error.message, 'error');
        await loadNavigation();
    }
}

function suppressClickAfterSort(event) {
    event.preventDefault();
    event.stopPropagation();
}

function handleSortPointerCancel() {
    clearTimeout(pointerSortTimer);
    detachPointerSortListeners();
    if (!pointerSortState) return;
    pointerSortState.item.classList.remove('dragging');
    pointerSortState = null;
    document.body.classList.remove('sorting-active');
    loadNavigation();
}

// 自动获取网页信息
async function autoFillLinkInfo() {
    const urlInput = document.getElementById('linkUrl');
    const nameInput = document.getElementById('linkName');
    const logoInput = document.getElementById('linkLogo');
    const descriptionInput = document.getElementById('linkDescription');
    const url = normalizeLinkInput(urlInput.value);

    if (!url) return;

    if (urlInput.value !== url) {
        urlInput.value = url;
    }

    const toast = showToast('正在获取网页信息...', 'loading');
    try {
        const [iconUrl, info] = await Promise.all([
            getIconUrl({ url }),
            fetchWebInfo(url)
        ]);

        // 只在字段为空时填充
        if (!nameInput.value) {
            nameInput.value = info.title || '';
        }
        if (!logoInput.value) {
            logoInput.value = iconUrl || '';
        }
        if (!descriptionInput.value) {
            descriptionInput.value = info.description || '';
        }

        toast.remove();
        showToast('获取网页信息成功');
    } catch (error) {
        toast.remove();
        showToast('获取网页信息失败: ' + error.message, 'error');
    }
}

// 生成分组操作按钮
function getGroupActions(groupId) {
    if (!isEditMode) return '';

    return `
        <div class="group-actions">
            <button onclick="openGroupModal(${groupId})" title="编辑">
                <i class="fas fa-edit"></i>
            </button>
            <button onclick="deleteGroupConfirm(${groupId})" title="删除">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
}

// 生成分组标题
function getGroupTitle(group) {
    return `
        <div class="group-title-left">
            ${escapeHTML(group.name)}
            ${group.is_private ?
                `<i class="fas fa-lock group-privacy-icon" title="私密分组"></i>` :
                (isEditMode ? `<i class="fas fa-lock-open group-privacy-icon" title="公开分组"></i>` : '')
            }
        </div>
    `;
}

// 生成链接卡片
function getLinkCard(link) {
    const safeLinkUrl = safeHttpUrl(link.url);
    const iconSrc = safeHttpUrl(link.logo || '', '#');
    const defaultIcon = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <rect width="24" height="24" rx="12" fill="#4299e1" opacity="0.1"/>
            <path fill="#4299e1" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
        </svg>
    `.trim());

    return `
        <a href="${safeLinkUrl}" target="_blank" rel="noopener noreferrer" class="link-card"
           data-link-id="${link.id}" data-group-id="${link.group_id}"
           ${isEditMode ? 'data-drag-type="link" title="按住并拖动调整顺序"' : ''}>
            <div class="link-info">
                <div class="link-icon">
                    <img src="${iconSrc}"
                        draggable="false"
                        data-url="${safeLinkUrl}"
                        alt="${escapeHTML(link.name)}"
                        ${!link.logo ? 'data-auto-icon="true"' : ''}
                        onerror="this.onerror=null; this.src='data:image/svg+xml,${defaultIcon}';">
                </div>
                <div class="link-text">
                    <span class="link-title">
                        ${escapeHTML(link.name)}
                    </span>
                    <div class="link-description">${escapeHTML(link.description || '')}</div>
                </div>
            </div>
            ${isEditMode ? `
                <div class="link-actions" onclick="event.preventDefault();">
                    <button onclick="openLinkModal(${link.id})" title="编辑">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteLinkConfirm(${link.id})" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            ` : ''}
        </a>
    `;
}

// 根据URL获取合适的后备图标
function getFallbackIcon(url) {
    const domain = new URL(url).hostname.toLowerCase();

    // 常见网站的图标映射
    const iconMap = {
        'github.com': 'github',
        'youtube.com': 'youtube',
        'twitter.com': 'twitter',
        'facebook.com': 'facebook',
        'instagram.com': 'instagram',
        'linkedin.com': 'linkedin',
        'medium.com': 'medium',
        'reddit.com': 'reddit',
        'stackoverflow.com': 'stack-overflow',
        'amazon.com': 'amazon',
        'google.com': 'google',
        'microsoft.com': 'microsoft',
        'apple.com': 'apple',
        'netflix.com': 'netflix',
        'spotify.com': 'spotify',
        'twitch.tv': 'twitch',
        'wikipedia.org': 'wikipedia-w',
        'wordpress.com': 'wordpress',
        'blogger.com': 'blogger',
        'pinterest.com': 'pinterest'
    };

    // 检查是否是已知网站
    for (const [site, icon] of Object.entries(iconMap)) {
        if (domain.includes(site)) {
            return icon;
        }
    }

    // 根据URL类型返回通用图标
    if (domain.includes('docs.') || domain.endsWith('.doc')) return 'file-word';
    if (domain.includes('sheets.') || domain.endsWith('.xls')) return 'file-excel';
    if (domain.includes('slides.') || domain.endsWith('.ppt')) return 'file-powerpoint';
    if (domain.includes('drive.') || domain.includes('cloud')) return 'cloud';
    if (domain.includes('mail.') || domain.includes('outlook')) return 'envelope';
    if (domain.includes('chat.') || domain.includes('meet.')) return 'comments';
    if (domain.includes('map')) return 'map-marker-alt';
    if (domain.includes('video') || domain.includes('tv')) return 'video';
    if (domain.includes('music') || domain.includes('audio')) return 'music';
    if (domain.includes('shop') || domain.includes('store')) return 'shopping-cart';
    if (domain.includes('game')) return 'gamepad';
    if (domain.includes('news')) return 'newspaper';
    if (domain.includes('blog')) return 'blog';

    // 默认图标
    return 'link';
}

// 加载图标
async function loadIcons() {
    const icons = document.querySelectorAll('.link-icon img');
    for (const img of icons) {
        if (img.dataset.autoIcon === 'true') {
            const url = img.dataset.url;
            if (url) {
                try {
                    const iconUrl = await getIconUrl({ url });
                    if (iconUrl) {
                        img.src = iconUrl;
                        img.crossOrigin = 'anonymous';
                    } else {
                        throw new Error('No icon found');
                    }
                } catch (error) {
                    img.src = defaultIcon;
                }
            }
        }
    }
}
