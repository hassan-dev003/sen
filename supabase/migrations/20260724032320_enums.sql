create type txn_source      as enum ('statement_pdf', 'm2u_history', 'finverse', 'manual');
create type txn_direction   as enum ('debit', 'credit');
create type txn_posting     as enum ('pending', 'posted');
create type txn_review      as enum ('draft', 'confirmed', 'ignored');
create type account_kind    as enum ('bank', 'cash');
create type category_kind   as enum ('expense', 'income', 'transfer');
create type batch_status    as enum ('parsing', 'ready', 'imported', 'failed', 'rolled_back');
create type rule_field      as enum ('description_normalized', 'reference');
create type rule_match      as enum ('contains', 'starts_with', 'exact', 'regex');
create type event_role      as enum ('single', 'authorization', 'auth_reversal',
                                     'settlement', 'settlement_reversal');
create type event_state     as enum ('resolved', 'pending', 'cancelled', 'orphan');
