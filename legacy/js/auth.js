// ==================== AUTHENTICATION ====================

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function login() {
    const password = document.getElementById('passwordInput').value;
    const hash = await hashPassword(password);
    
    if (hash === PASSWORD_HASH) {
        localStorage.setItem('authenticated', 'true');
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        loadAllData();
    } else {
        document.getElementById('loginError').textContent = '❌ Mật khẩu không đúng';
    }
}

function logout() {
    localStorage.removeItem('authenticated');
    location.reload();
}

function checkAuth() {
    if (localStorage.getItem('authenticated') === 'true') {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appContainer').style.display = 'block';
        loadAllData();
    }
}

// Handle Enter key in password field
document.addEventListener('DOMContentLoaded', () => {
    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                login();
            }
        });
    }
});
