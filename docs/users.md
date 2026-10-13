# Users, roles and access

Login is **off** when a shop starts. One person behind one counter does not want
to type a password to sell a packet of tea, and every document written in that
mode is stamped with the shop's single seeded operator.

Turn it on in **Settings → Users**, once somebody has a password. The app
refuses to turn it on before that: a shop that locked itself out of its own till
would have no way back that did not involve us.

## Roles

| Role        | What it covers                                                |
| ----------- | ------------------------------------------------------------- |
| **Owner**   | Everything, including users, settings, the books and backups  |
| **Manager** | Billing, voids, returns, stock, purchases, reports, the books |
| **Cashier** | Bills customers and keeps their details. Nothing else         |

Roles are fixed. A shop of this size does not want to design a permission
matrix, and a role that can be edited is a role nobody can reason about.

## Where it is enforced

In the main process, at the IPC layer. Every channel passes a gate before its
handler runs: it needs a session, and if the channel names a permission, a role
that has it. The screens hide what a role cannot do, but that is a courtesy —
a renderer that asked anyway would be refused.

## Approval

A void and a return are checked differently from everything else, because a
shop usually wants a cashier to be able to undo a small mistake and not a large
one.

- A role that covers the act does it alone, whatever the value.
- A role that does not may still do one **at or below** the shop's threshold.
- Above it, somebody whose role does cover it types their own username and
  password into the same dialog. It approves that one act: the till stays with
  whoever is standing at it, and both names go into the audit trail.

With approval switched off, the role is the whole answer and a cashier cannot
void at all.

## Passwords

- scrypt, with the cost parameters stored alongside the hash so they can be
  raised later without invalidating what is already there.
- Compared in constant time.
- A password an administrator sets is used exactly once: the next sign-in makes
  that person choose their own.
- A wrong username and a wrong password are refused in the same words, so the
  screen cannot be used to find out who works at the shop.
- There is no password recovery. An owner resets another user's password from
  Settings → Users; if every owner password is lost, the database must be
  opened by hand, which is deliberate.

## Locking

The till locks itself after the minutes set in Settings, and anyone can lock it
from the sidebar before stepping away. A lock keeps the name on screen so coming
back is one password; signing out does not.

Idle time is measured in the main process, over real work only — a screen asking
whether the session is still alive does not count as use.

## What is written down

Every sign-in, failed sign-in, lock, sign-out, password change, password reset,
user created, user deactivated and approval given goes into the audit trail,
with who did it. A run of failed sign-ins is the only sign a shop would get that
somebody is trying passwords at the counter.
