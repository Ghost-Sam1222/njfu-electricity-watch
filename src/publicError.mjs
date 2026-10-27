// Only locally authored messages may cross the log/notification boundary.
export class PublicError extends Error {}

export function publicErrorMessage(error) {
  return error instanceof PublicError ? error.message : '查询或配置处理失败，请检查登录状态和配置';
}
