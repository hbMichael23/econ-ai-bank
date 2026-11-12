let session = {
  token: '',
  userSetId: '',
  deviceLabel: '',
  imageMode: 'text_only'
};

export function setSession(next = {}) {
  session = { ...session, ...next };
  return session;
}

export function getSession() {
  return session;
}
