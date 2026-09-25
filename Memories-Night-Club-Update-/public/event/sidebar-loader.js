// sidebar-loader.js
async function loadSidebar() {
    try {
        const response = await fetch('sidebar.html');
        const html = await response.text();
        document.getElementById('sidebar-container').innerHTML = html;

        // Highlight current page in sidebar
        const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
        document.querySelectorAll('.nav-link').forEach(link => {
            const href = link.getAttribute('href');
            if (href === currentPage) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Attach logout handler
        document.getElementById('sidebarLogoutBtn')?.addEventListener('click', async () => {
            await firebase.auth().signOut();
            showToast('Logged out', 'info');
            setTimeout(() => window.location.href = 'login.html', 500);
        });

        // Update user info when auth changes
        firebase.auth().onAuthStateChanged(user => {
            const nameEl = document.getElementById('sidebarAdminName');
            const emailEl = document.getElementById('sidebarAdminEmail');
            if (user) {
                if (nameEl) nameEl.textContent = user.displayName || 'Admin';
                if (emailEl) emailEl.textContent = user.email || 'Administrator';
            }
        });

        return true;
    } catch (error) {
        console.error('Sidebar load error:', error);
        return false;
    }
}