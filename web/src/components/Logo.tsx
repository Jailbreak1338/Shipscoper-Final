interface LogoProps {
  className?: string;
  /** text-xl (default) | text-lg | text-2xl */
  size?: 'sm' | 'md' | 'lg';
}

export default function Logo({ className = '', size = 'md' }: LogoProps) {
  const sizeClass = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-xl';

  return (
    <span
      className={`font-bold tracking-tight leading-none ${sizeClass} ${className}`}
      style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
    >
      <span className="text-signal">Ship</span>
      <span className="text-white">scoper</span>
    </span>
  );
}
