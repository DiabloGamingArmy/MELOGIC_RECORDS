# StageMaker Production Notes

StageMaker cloud projects use:

- `stageProjects/{projectId}` for the full stage plan.
- `users/{uid}/stageProjectIndex/{projectId}` for the signed-in user's dashboard index.

## Firestore Access Shape

- Signed-in users may create `stageProjects` only when `ownerId == request.auth.uid`, `visibility == private`, `type == stage-plan`, and the stage payload matches the allowed StagePlan shape.
- Owners may read, update, and delete their own projects.
- Collaborators may read projects where their uid is present in `collaboratorIds`.
- Updates must preserve the original `ownerId`, `createdAt`, and `collaboratorIds`.
- User index docs are owner-only and must keep `projectId`, `ownerId`, `visibility`, `type`, and `stageType` aligned with the project card shape.

## Manual Validation

This repo does not currently include Firestore rules unit tests for StageMaker. Validate manually after deploying rules:

1. Sign in on production.
2. Open `/studio/stagemaker`.
3. Create a Blank Stage project and one template project.
4. Confirm both documents exist in `stageProjects`.
5. Confirm matching docs exist in `users/{uid}/stageProjectIndex`.
6. Open the project editor and make a small change.
7. Confirm `updatedAt`/`lastOpenedAt`, `plan`, and `editorState` save without `permission-denied`.
8. Confirm a different signed-in account cannot open the private project unless added to `collaboratorIds`.

## Production Operations

1. Add `melogicrecords.studio` to Firebase Authentication authorized domains.
2. Deploy Firestore rules.
3. Apply Firebase Storage CORS from `firebase-storage-cors.json`; normal Firebase deploys do not apply bucket CORS.
4. Redeploy hosting so `/studio/stagemaker` serves the StageMaker app.
