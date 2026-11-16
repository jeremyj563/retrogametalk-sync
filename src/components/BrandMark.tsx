import { useEffect, useState } from 'react';
import { DEFAULT_BRAND_TITLE, isVideoBrandLogoUrl } from '../shared/brandLogo';

interface BrandMarkProps {
  url: string;
  fallbackText?: string;
  onMediaLoad?: () => void;
  onMediaError?: () => void;
}

export function BrandMark({
  url,
  fallbackText = DEFAULT_BRAND_TITLE,
  onMediaLoad,
  onMediaError,
}: BrandMarkProps) {
  const trimmedUrl = url.trim();
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [trimmedUrl]);

  if (!trimmedUrl || loadFailed) {
    return (
      <span className="font-display text-lg font-bold tracking-tight text-crt-phosphor whitespace-nowrap shrink-0">
        {fallbackText}
      </span>
    );
  }

  if (isVideoBrandLogoUrl(trimmedUrl)) {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return (
      <video
        key={trimmedUrl}
        src={trimmedUrl}
        autoPlay={!prefersReducedMotion}
        loop
        muted
        playsInline
        aria-label={fallbackText}
        onLoadedData={() => {
          setLoadFailed(false);
          onMediaLoad?.();
        }}
        onError={() => {
          setLoadFailed(true);
          onMediaError?.();
        }}
        className="block max-h-8 w-auto max-w-[240px] object-contain object-left select-none shrink-0"
      />
    );
  }

  return (
    <img
      key={trimmedUrl}
      src={trimmedUrl}
      alt={fallbackText}
      referrerPolicy="no-referrer"
      onLoad={() => {
        setLoadFailed(false);
        onMediaLoad?.();
      }}
      onError={() => {
        setLoadFailed(true);
        onMediaError?.();
      }}
      className="block max-h-8 w-auto max-w-[240px] object-contain object-left select-none shrink-0"
    />
  );
}
