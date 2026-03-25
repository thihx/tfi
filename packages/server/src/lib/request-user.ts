import type { UserRole, UserRow, UserStatus } from '../repos/users.repo.js';

export interface RequestUser {
  userId: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName: string;
  avatarUrl: string;
}

export function toRequestUser(user: UserRow): RequestUser {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
  };
}

export function toAuthUserResponse(user: UserRow): {
  userId: string;
  email: string;
  name: string;
  displayName: string;
  picture: string;
  avatarUrl: string;
  role: UserRole;
  status: UserStatus;
} {
  return {
    userId: user.id,
    email: user.email,
    name: user.display_name,
    displayName: user.display_name,
    picture: user.avatar_url,
    avatarUrl: user.avatar_url,
    role: user.role,
    status: user.status,
  };
}