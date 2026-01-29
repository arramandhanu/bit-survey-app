/**
 * Admin Dashboard - Shared JavaScript Functions
 */

/**
 * Check if user is authenticated
 */
function checkAuth() {
    const token = localStorage.getItem('adminToken');
    return !!token;
}

/**
 * Get auth token
 */
function getToken() {
    return localStorage.getItem('adminToken');
}

/**
 * Fetch with authorization header
 */
async function fetchWithAuth(url, options = {}) {
    const token = getToken();

    if (!token) {
        window.location.href = '/admin';
        throw new Error('Not authenticated');
    }

    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        window.location.href = '/admin';
        throw new Error('Session expired');
    }

    return response;
}

/**
 * Format number with locale
 */
function formatNumber(num) {
    return new Intl.NumberFormat('id-ID').format(num);
}

/**
 * Format date in Indonesian locale with Jakarta timezone
 */
function formatDate(date) {
    return new Date(date).toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}
