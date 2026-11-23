import React from 'react';

export type MarLogoVariant = 'aviso' | 'm-naranja' | 'burbuja' | 'cola';

interface MarLogoProps {
  size?: number;
  variant?: MarLogoVariant;
  className?: string;
}

export const MarLogo: React.FC<MarLogoProps> = ({
  size = 36,
  variant = 'aviso',
  className = '',
}) => {
  const isOrangeBubble = variant === 'burbuja';
  const isOrangeTail = variant === 'cola';
  const isOrangeM = variant === 'm-naranja';
  const hasOrangeDot = variant === 'aviso';

  const bubbleFill = isOrangeBubble ? '#FF8A1F' : '#FFFFFF';
  const tailFill = isOrangeBubble || isOrangeTail ? '#FF8A1F' : '#FFFFFF';
  const mStroke = isOrangeBubble ? '#FFFFFF' : isOrangeM ? '#FF8A1F' : '#6D3FE0';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Logo de MAR"
    >
      <rect width="120" height="120" rx="28" fill="#6D3FE0" />
      <circle cx="60" cy="52" r="34" fill={bubbleFill} />
      <path fill={tailFill} d="M76 78L90 98L58 86Z" />
      <path
        d="M44 66V48M44 54Q44 44 52 44Q60 44 60 54V66M60 54Q60 44 68 44Q76 44 76 54V66"
        fill="none"
        stroke={mStroke}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {hasOrangeDot && (
        <circle
          cx="88"
          cy="26"
          r="11"
          fill="#FF8A1F"
          stroke="#6D3FE0"
          strokeWidth="4"
        />
      )}
    </svg>
  );
};
