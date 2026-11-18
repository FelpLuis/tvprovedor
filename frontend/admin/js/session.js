const LEVEL = { viewer: 1, operator: 2, admin: 3 };

export const session = {
  user: null,
  /** O backend sempre valida; aqui serve apenas para ocultar ações indisponíveis. */
  can(role) {
    return !!this.user && (LEVEL[this.user.role] || 0) >= LEVEL[role];
  },
};
