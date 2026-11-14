import { KITS, KIT_IDS, getRole, substitutedRoles, type KitId } from '@boombapbot/contracts';
import { useEditorState, useRuntime } from './context';
import { Segmented } from './Segmented';

function substitutionNote(id: KitId): string | undefined {
  const kit = KITS[id];
  const roles = substitutedRoles(kit);
  if (roles.length === 0) return undefined;
  return roles
    .map((role) => `${getRole(role).name} plays ${kit.voices[role].label}`)
    .join(', ');
}

export function KitPicker() {
  const runtime = useRuntime();
  const kitId = useEditorState((state) => state.project.kit.id);
  const kitStatus = useEditorState((state) => state.kitStatus);
  const kit = KITS[kitId];
  const note = substitutionNote(kitId);

  return (
    <section className="sb-kit" aria-label="Kit">
      <div className="sb-label-row">
        <span className="sb-label">Kit</span>
        <span className="sb-tag" title="Synthesised placeholder sounds, not recordings of the hardware">
          demo sounds
        </span>
      </div>
      <Segmented
        label="Drum kit"
        className="sb-kit-options"
        value={kitId}
        onChange={(id) => runtime.store.setKit(id)}
        options={KIT_IDS.map((id) => ({
          value: id,
          name: `${KITS[id].name}${substitutionNote(id) ? `. ${substitutionNote(id)}` : ''}`,
          description: KITS[id].description,
          testId: `kit-${id}`,
          label: <span className="sb-kit-number">{id}</span>,
        }))}
      />
      <p className="sb-hint" data-testid="kit-note" aria-live="polite">
        {kitStatus === 'loading' ? 'Loading sounds… ' : ''}
        {kit.description.split('.')[0]}.{note ? ` ${note}.` : ''}
      </p>
    </section>
  );
}
