/** API composition root. */
export {
  createCompanyActorApplication,
  type CompanyActorApplication,
  type CompanyActorApplicationDependencies,
} from "./company-actor.js";
export {
  createRoomApplication,
  type RoomApplication,
  type RoomApplicationDependencies,
} from "./room.js";
export {
  createHumanInvitationAdmissionPolicy,
  type HumanInvitationAdmissionPolicyCompositionDependencies,
} from "./human-invitation-admission.js";
