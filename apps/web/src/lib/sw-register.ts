export function registerServiceWorker(): void {
    if(typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }
    if(!import.meta.env.PROD) {
        return;
    }

    window.addEventListener('load', () => {
        void navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => undefined)
    }, {once: true});
}