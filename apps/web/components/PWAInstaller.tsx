'use client';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstaller() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }

    // Capture install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
    }
    setInstallPrompt(null);
  };

  if (!showInstallBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-primary-500 text-white p-3 flex justify-between items-center z-50 safe-area-bottom">
      <span className="text-sm">Install ZapMate for quick access!</span>
      <div className="flex gap-2">
        <button
          onClick={() => setShowInstallBanner(false)}
          className="text-xs px-3 py-1 bg-white/20 rounded min-h-[32px]"
        >
          Later
        </button>
        <button
          onClick={handleInstall}
          className="text-xs px-3 py-1 bg-white text-primary-500 rounded font-medium min-h-[32px]"
        >
          Install
        </button>
      </div>
    </div>
  );
}
