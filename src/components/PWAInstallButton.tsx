import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { MarLogo } from './MarLogo';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'surface' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'sidebar' }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, canShowInstall, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || !canShowInstall) {
    return null;
  }

  const handleTriggerInstall = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  const buttonClasses =
    variant === 'sidebar'
      ? 'w-full flex items-center justify-center gap-2 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] px-3 py-2 text-xs font-bold text-[#1E1B4B] shadow-sm transition-colors whitespace-nowrap min-h-[40px]'
      : variant === 'compact'
      ? 'inline-flex items-center gap-1.5 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] px-2.5 sm:px-3 py-1.5 text-xs font-bold text-[#1E1B4B] shadow-sm transition-colors whitespace-nowrap shrink-0 min-h-[36px]'
      : 'inline-flex items-center gap-2 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] px-3.5 py-2 text-xs font-bold text-[#1E1B4B] shadow-sm transition-colors whitespace-nowrap min-h-[40px]';

  const label =
    variant === 'compact'
      ? 'Instalar'
      : isIOS
      ? 'Instalar en iPhone'
      : 'Instalar app';

  return (
    <>
      <button
        type="button"
        onClick={handleTriggerInstall}
        className={buttonClasses}
        title="Instalar MAR como aplicación en tu dispositivo"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>

      {showGuide && (
        <InstallMobileGuideModal
          isIOS={isIOS}
          isInIframe={isInIframe}
          onClose={() => setShowGuide(false)}
        />
      )}
    </>
  );
};

export const MobileInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isMobile, isInIframe, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('mar_install_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || !isMobile || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('mar_install_banner_dismissed', '1');
    } catch {
      // ignore
    }
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <div className="md:hidden flex items-center justify-between gap-2.5 px-3 py-2 bg-[#1E1B4B] text-white border-b border-[#312E81] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <MarLogo size={32} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold font-display leading-tight truncate">
              Instala MAR en tu móvil
            </p>
            <p className="text-[11px] text-[#DDD6FE]/80 truncate">
              App nativa con alertas push y pantalla completa
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleInstallClick}
            className="rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] px-3 py-1.5 text-xs font-bold text-[#1E1B4B] whitespace-nowrap"
          >
            Instalar
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-[#DDD6FE]/70 hover:text-white"
            aria-label="Cerrar aviso de instalación"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showGuide && (
        <InstallMobileGuideModal
          isIOS={isIOS}
          isInIframe={isInIframe}
          onClose={() => setShowGuide(false)}
        />
      )}
    </>
  );
};

type DeviceTab = 'android' | 'ios' | 'desktop';

const InstallMobileGuideModal: React.FC<{
  isIOS: boolean;
  isInIframe: boolean;
  onClose: () => void;
}> = ({ isIOS, isInIframe, onClose }) => {
  const [tab, setTab] = useState<DeviceTab>(isIOS ? 'ios' : 'android');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopyUrl = async () => {
    if (!currentUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#151238]/80 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-install-title"
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#DDD6FE] dark:border-[#5B21B6]/60 bg-white dark:bg-[#1E1B4B] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl text-[#1E1B4B] dark:text-[#F5F3FF]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <MarLogo size={34} className="shrink-0" />
            <div className="min-w-0">
              <h3 id="mobile-install-title" className="text-base font-bold font-display truncate">
                Instalar app MAR
              </h3>
              <p className="text-[11px] text-[#5B21B6] dark:text-[#DDD6FE]/80">
                Acceso directo, pantalla completa y alertas push
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#5B21B6] hover:text-[#1E1B4B] dark:text-[#DDD6FE] dark:hover:text-white min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Cerrar guía"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selector de dispositivo */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-[#F5F3FF] dark:bg-[#151238] p-1 border border-[#DDD6FE] dark:border-[#312E81]">
          <button
            type="button"
            onClick={() => setTab('android')}
            className={`rounded-lg py-1.5 px-2 text-xs font-semibold transition-colors ${
              tab === 'android'
                ? 'bg-[#5B21B6] text-white'
                : 'text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 hover:text-[#1E1B4B] dark:hover:text-white'
            }`}
          >
            Android
          </button>
          <button
            type="button"
            onClick={() => setTab('ios')}
            className={`rounded-lg py-1.5 px-2 text-xs font-semibold transition-colors ${
              tab === 'ios'
                ? 'bg-[#5B21B6] text-white'
                : 'text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 hover:text-[#1E1B4B] dark:hover:text-white'
            }`}
          >
            iPhone / iPad
          </button>
          <button
            type="button"
            onClick={() => setTab('desktop')}
            className={`rounded-lg py-1.5 px-2 text-xs font-semibold transition-colors ${
              tab === 'desktop'
                ? 'bg-[#5B21B6] text-white'
                : 'text-[#1E1B4B]/70 dark:text-[#DDD6FE]/75 hover:text-[#1E1B4B] dark:hover:text-white'
            }`}
          >
            PC / Mac
          </button>
        </div>

        {isInIframe && (
          <div className="mt-3 rounded-xl border border-[#FF8A1F]/40 bg-[#FF8A1F]/10 p-3 text-xs text-[#1E1B4B] dark:text-[#F5F3FF] space-y-2">
            <p className="leading-relaxed">
              Estás viendo MAR dentro de una vista previa incrustada. Para que aparezca la
              instalación nativa, abre este enlace directo en el navegador de tu celular:
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8A1F] hover:bg-[#F97316] px-2.5 py-1.5 text-[11px] font-bold text-[#1E1B4B]"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl ? 'Enlace copiado' : 'Copiar enlace'}</span>
              </button>
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] dark:border-[#5B21B6] bg-white dark:bg-[#151238] px-2.5 py-1.5 text-[11px] font-semibold text-[#5B21B6] dark:text-[#DDD6FE] hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Abrir en pestaña</span>
              </a>
            </div>
          </div>
        )}

        {tab === 'ios' ? (
          <ol className="mt-4 space-y-3 text-sm text-[#1E1B4B]/85 dark:text-[#DDD6FE]">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>
                Abre la URL de <strong>MAR</strong> directamente en <strong>Safari</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>
                Toca el botón{' '}
                <strong className="inline-flex items-center gap-1 text-[#1E1B4B] dark:text-white">
                  <Share className="w-3.5 h-3.5 text-[#5B21B6] dark:text-[#FF8A1F]" /> Compartir
                </strong>{' '}
                en la barra inferior y elige{' '}
                <strong className="inline-flex items-center gap-1 text-[#1E1B4B] dark:text-white">
                  <PlusSquare className="w-3.5 h-3.5 text-[#5B21B6] dark:text-[#FF8A1F]" /> Añadir a
                  pantalla de inicio
                </strong>
                .
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <span>
                Pulsa <strong className="text-[#1E1B4B] dark:text-white">Añadir</strong> y abre{' '}
                <strong>MAR</strong> desde tu pantalla de inicio.
              </span>
            </li>
          </ol>
        ) : tab === 'android' ? (
          <ol className="mt-4 space-y-3 text-sm text-[#1E1B4B]/85 dark:text-[#DDD6FE]">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>
                Abre <strong>MAR</strong> en <strong>Google Chrome</strong> o <strong>Edge</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>
                Toca el menú{' '}
                <strong className="inline-flex items-center gap-0.5 text-[#1E1B4B] dark:text-white">
                  <MoreVertical className="w-3.5 h-3.5 text-[#5B21B6] dark:text-[#FF8A1F]" /> arriba
                  a la derecha
                </strong>{' '}
                y selecciona{' '}
                <strong className="inline-flex items-center gap-1 text-[#1E1B4B] dark:text-white">
                  <Smartphone className="w-3.5 h-3.5 text-[#5B21B6] dark:text-[#FF8A1F]" /> Instalar
                  aplicación
                </strong>
                .
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <span>
                Confirma <strong className="text-[#1E1B4B] dark:text-white">Instalar</strong> para
                tener el ícono en tu móvil con alertas push.
              </span>
            </li>
          </ol>
        ) : (
          <ol className="mt-4 space-y-3 text-sm text-[#1E1B4B]/85 dark:text-[#DDD6FE]">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <span>
                Abre <strong>MAR</strong> en <strong>Chrome</strong> o <strong>Edge</strong> en tu
                computadora (fuera del visor embebido).
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF8A1F] text-[#1E1B4B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <span>
                Haz clic en el ícono{' '}
                <strong className="inline-flex items-center gap-1 text-[#1E1B4B] dark:text-white">
                  <Laptop className="w-3.5 h-3.5 text-[#5B21B6] dark:text-[#FF8A1F]" /> Instalar MAR
                </strong>{' '}
                a la derecha de la barra de direcciones o usa este mismo botón cuando esté habilitado.
              </span>
            </li>
          </ol>
        )}

        <div className="mt-5 flex items-center gap-2">
          {!isInIframe && (
            <button
              type="button"
              onClick={handleCopyUrl}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#DDD6FE] dark:border-[#5B21B6] py-3 text-xs font-semibold text-[#5B21B6] dark:text-[#DDD6FE] hover:bg-[#F5F3FF] dark:hover:bg-[#292466] transition-colors"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? '¡Copiado!' : 'Copiar enlace'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-[#5B21B6] hover:bg-[#4C1D95] py-3 text-sm font-semibold text-white transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
