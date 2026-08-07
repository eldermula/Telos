type LogoProps = {
  variant: 'sidebar-mark' | 'full';
  className?: string;
};

const SOURCES: Record<LogoProps['variant'], { webp: string; png: string; alt: string }> = {
  'sidebar-mark': {
    webp: '/brand/sidebar-mark-64.webp',
    png: '/brand/sidebar-mark-64.png',
    alt: 'Telos',
  },
  full: {
    webp: '/brand/logo-full.webp',
    png: '/brand/logo-full.png',
    alt: 'Telos',
  },
};

export function BrandLogo({ variant, className }: LogoProps) {
  const src = SOURCES[variant];
  return (
    <picture>
      <source srcSet={src.webp} type="image/webp" />
      <img src={src.png} alt={src.alt} className={className} />
    </picture>
  );
}
