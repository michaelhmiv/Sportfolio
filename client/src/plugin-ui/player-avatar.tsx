import { useState } from "react";
import { initials, text, type JsonRecord } from "./plugin-ui-values";

type PlayerAvatarProps = {
  player: JsonRecord;
  className?: string;
  fallbackClassName?: string;
};

export function PlayerAvatar({
  player,
  className = "avatar",
  fallbackClassName = "avatar avatar-fallback",
}: PlayerAvatarProps) {
  const name = text(player.displayName, "Unknown player");
  const image = text(player.imageUrl);
  const [imageFailed, setImageFailed] = useState(false);

  if (!image || imageFailed) {
    return <div className={fallbackClassName}>{initials(name)}</div>;
  }

  return (
    <img
      className={className}
      src={image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
    />
  );
}
