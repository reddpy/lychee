import horizontalLogoUrl from '../../assets/logos/lychee-logo-horizontal.svg';
import horizontalLogoDarkUrl from '../../assets/logos/lychee-logo-horizontal-dark.svg';
import iconLogoUrl from '../../assets/logos/lychee-icon.svg';

export function LycheeLogoHorizontal({
  className = 'h-6',
}: {
  className?: string;
}) {
  return (
    <>
      <img
        src={horizontalLogoUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`${className} dark:hidden`}
      />
      <img
        src={horizontalLogoDarkUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`${className} hidden dark:block`}
      />
    </>
  );
}

export function LycheeLogo({
  className = 'h-4 w-4',
}: {
  className?: string;
}) {
  return (
    <img
      src={iconLogoUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`object-contain ${className}`}
    />
  );
}
