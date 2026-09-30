/** Where a teacher reaches a person: for help, and for what Test Parrot
 *  should read that it does not yet. */
export const SUPPORT_EMAIL = 'support@teacher.dev'

/** A link that starts an email to support about one thing. */
export const supportMailto = (subject: string) => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
