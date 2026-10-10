import downtownDrivingLogo from '../assets/branding/downtown-driving-logo.png';

interface DowntownDrivingLogoProps {
  className?: string;
  variant?: 'hud' | 'loading';
}

export function DowntownDrivingLogo({
  className = '',
  variant = 'hud',
}: DowntownDrivingLogoProps) {
  return (
    <div className={`brand-logo brand-logo--${variant} ${className}`.trim()}>
      <img
        src={downtownDrivingLogo}
        alt="Downtown Driving"
        className="brand-logo__image"
        draggable={false}
      />
    </div>
  );
}
