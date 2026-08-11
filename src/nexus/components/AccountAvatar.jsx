import { useMemo, useState } from "react";

function initialsFromAccount(account) {
  const firstName = account?.firstName?.trim();
  const lastName = account?.lastName?.trim();

  if (firstName && lastName) {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  }

  if (firstName) {
    return firstName.slice(0, 2).toUpperCase();
  }

  const displayName =
    account?.displayName?.trim();

  if (displayName) {
    return displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  if (account?.email) {
    return account.email
      .slice(0, 2)
      .toUpperCase();
  }

  return "M";
}

export default function AccountAvatar({
  account,
  size = "normal",
}) {
  const [imageFailed, setImageFailed] =
    useState(false);

  const initials = useMemo(
    () => initialsFromAccount(account),
    [account],
  );

  const showImage =
    Boolean(account?.photoURL) && !imageFailed;

  return (
    <span
      className={`nexus-avatar nexus-avatar-${size}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={account.photoURL}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}
