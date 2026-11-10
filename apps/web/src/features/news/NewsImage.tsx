import { useState } from 'react';

export interface NewsImageProps {
  src: string;
  width: number;
  height: number;
}

export function NewsImage({ src, width, height }: NewsImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={width}
      height={height}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
