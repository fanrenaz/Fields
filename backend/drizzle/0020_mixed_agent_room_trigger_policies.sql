ALTER TABLE "agent_room_states"
  DROP CONSTRAINT "agent_room_states_trigger_policy_check";
--> statement-breakpoint
ALTER TABLE "agent_room_states"
  ADD CONSTRAINT "agent_room_states_trigger_policy_check"
  CHECK ("trigger_policy" IN (
    'human_explicit',
    'member_explicit',
    'human_auto',
    'member_auto',
    'human_explicit_agent_auto',
    'agent_explicit_human_auto'
  ));
--> statement-breakpoint
ALTER TABLE "agent_room_executions"
  DROP CONSTRAINT "agent_room_executions_trigger_policy_check";
--> statement-breakpoint
ALTER TABLE "agent_room_executions"
  ADD CONSTRAINT "agent_room_executions_trigger_policy_check"
  CHECK ("trigger_policy" IN (
    'human_explicit',
    'member_explicit',
    'human_auto',
    'member_auto',
    'human_explicit_agent_auto',
    'agent_explicit_human_auto'
  ));
