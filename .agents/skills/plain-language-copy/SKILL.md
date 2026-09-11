---
name: plain-language-copy
description: >-
  Owner's plain-language law for every word rendered into a My MaNaGeR
  page: no jargon, no over-explaining, no engineer vocabulary in user
  faces. Use when writing or editing any served copy: labels, notes,
  toasts, empty states, admin setup text, sign-in forms, field guide,
  marketing. Trigger phrases: "too many words", "the user doesn't know
  what hashed means", "over explaining", "keep it simple", any new
  surface that needs text.
---

# Plain Language Copy — say it like a person

The owner's law: product copy speaks like a human helping another
human, not like documentation or a security briefing. The admin setup
screen once explained PBKDF2 hashing and local storage in three
paragraphs. The user does not know what "hashed" means, does not need
to, and stopped reading two sentences in. Every word on a served page
must earn its place.

## The law

1. **Name the thing, not the mechanism.** "Set up admin access" not
   "Create an admin credential which will be hashed with PBKDF2 and
   stored in device-local storage."
2. **One short note is allowed.** If the user genuinely benefits from
   knowing where data lives, ONE line: "Your password stays on this
   device." Then stop. No second sentence about hashing, salts, or
   storage layers.
3. **Fields are labels, not paragraphs.** "New admin password" +
   "Confirm password". That is the whole form head. Buttons say what
   they do: "Save", "Sign in", "Create project".
4. **Never explain in the UI what the field guide explains better.**
   Deep detail (how backup works, what cloud sync does, what codes
   mean) lives in mymanager-field-guide.html. The UI carries a link,
   not a lecture.
5. **Banned vocabulary in user-facing copy** (use the plain form):
   - hashed / hash / salt / PBKDF2 / iteration count -> say nothing,
     or "scrambled and stored safely" only if truly needed
   - "stored locally on this device in localStorage" -> "stays on
     this device"
   - "authenticate" -> "sign in"
   - "credential(s)" -> "password" or "code"
   - "provision" / "initialize" / "persist" -> "set up" / "start" /
     "save"
   - "utilize" -> "use"
   - "via" -> "with" or "through"
6. **No over-explaining an absence.** "No admin account on this
   device yet" plus three more lines is bloat. The form itself says
   what to do: "Set up admin access" + two fields + one button.
7. **Tone: calm, direct, respectful.** No exclamation marks in app
   chrome. No apologies in system messages ("Oops!") unless the user
   lost something. Errors say what happened and what to do: "That
   code did not match. Try again or use your recovery code."

## Where this applies

- Served HTML pages and every JS string that renders into them:
  toasts, status lines, empty states, modals, prompts, exports.
- Marketing copy: same rules, plus the ui-modernization copy law
  (no em dashes, no tagline tangles).
- The field guide may go deeper but still obeys sentence length and
  banned vocabulary.

## Examples from this project (owner-approved direction)

- Admin setup: heading "Set up admin access"; fields "New admin
  password" / "Confirm password"; button "Save password"; ONE note:
  "Your password stays on this device." (The old version explained
  hashing and storage and ran to a full paragraph.)
- Backup row when not backed up: "Not backed up" + one action "Sign
  in to back up" (not a paragraph about cloud architecture).
- Sign-in card: "Email", "Password", button "Sign in", then
  "Continue with Google", then a plain "Forgot password?" link. No
  bordered boxes around the links; let them float.

## Review checklist for any new copy

- Could a person at a job site, on a phone, in a hurry, act on this
  in one reading?
- Is every engineer word removed (check the banned list)?
- Is anything explained that the interface already shows?
- Is the note ONE line?
- Does the field guide, not the UI, carry the depth?
