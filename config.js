window.ARROWVERSE_SUPABASE_CONFIG = {
  url: 'https://lxbkvhwmvyguybunzffv.supabase.co',
  anonKey: 'sb_publishable_Fdf3sVgWqCs5xmcQgyjLTw_N7A-NhwP',
  table: 'arrowverse_progress',
};

window.ARROWVERSE_SUPABASE_READY = (function loadSupabaseClient() {
  if (location.protocol === 'chrome-extension:') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
})();
