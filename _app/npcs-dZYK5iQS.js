const n=`# FIXTURE roster for ?fixtures=1 only.
npcs:
  - id: fx_dana
    name: Dana (fixture)
    pack: shared
    community: us
    role: neighbor
    stance: none
    portrait: ch_fx_dana
    figure: ch_fx_dana_fig_stand       # missing from manifest on purpose: silhouette expected
    seated: false
    appearances:
      - { scene: plaza, slot: bench_left, chance: 1.0 }
    initial: { met: false, rapport: 0, lastValence: none }

  - id: fx_lin
    name: Mr. Lin (fixture)
    pack: cn
    community: home
    role: local_leader
    stance: separation
    portrait: ch_fx_lin                # placeholder portrait in manifest
    figure: ch_fx_lin_fig_sit
    seated: true
    appearances:
      - { scene: plaza, slot: chess, chance: 1.0 }
    initial: { met: false, rapport: 0, lastValence: none }
`;export{n as default};
