import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SlideLabel } from "../components/settings/SlideLabel";
import { NameTiles } from "../components/settings/NameTiles";
import { ReduceMotionSwitch, reduceMotionHelp } from "../components/settings/ReduceMotionSwitch";
import { useMotionChoice, useReduceMotion } from "../components/motion/MotionProvider";
import { enter } from "../components/motion/tokens";
import { requireProfile } from "../lib/requireProfile";
import "../components/settings/settings.css";

// Settings: a hero with the two names as letter tiles, then grouped rows (Profile, Accessibility, Camera, Privacy).
// Guest-only: profile, progress and mistakes stay in this browser (localStorage).

function Row({ id, label, desc, children }: { id: string; label: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <p className="set-row-label" id={`${id}-label`}>{label}</p>
        {desc && <p className="set-row-desc" id={`${id}-desc`}>{desc}</p>}
      </div>
      {children && <div className="set-row-control">{children}</div>}
    </div>
  );
}

function Group({ id, title, index, children }: { id: string; title: string; index: number; children: ReactNode }) {
  const reduce = useReduceMotion();
  return (
    <motion.section className="set-group" aria-labelledby={`${id}-title`} {...enter(index, reduce)}>
      <h2 className="set-group-title" id={`${id}-title`}>{title}</h2>
      <div className="set-surface">{children}</div>
    </motion.section>
  );
}

export function Settings() {
  const profile = requireProfile();
  const reduce = useReduceMotion();
  const { os } = useMotionChoice();
  return (
    <div className="page set-page">
      <motion.header className="set-hero" {...enter(0, reduce)}>
        <h1>Settings</h1>
        <p className="set-hero-sub">Your names, your hand and how Handshake moves, kept in this browser.</p>
        <div className="set-people">
          <NameTiles name={profile.userName} label="You" />
          {profile.theirName ? (
            <>
              <span className="set-arrow" aria-hidden="true">→</span>
              <NameTiles name={profile.theirName} label="Learning for" />
            </>
          ) : (
            <p className="set-solo">Learning for yourself</p>
          )}
          <p className="set-chip"><span className="set-chip-dot" aria-hidden="true" />{profile.leftHanded ? "Left" : "Right"}-handed</p>
        </div>
      </motion.header>

      <Group id="set-profile" title="Profile" index={1}>
        <Row id="set-names" label="Names and hand" desc="Stored in this browser only.">
          <a className="set-btn set-btn-primary" href="#/welcome" aria-label="Change names or hand"><SlideLabel>Change</SlideLabel></a>
        </Row>
      </Group>

      <Group id="set-access" title="Accessibility" index={2}>
        <Row id="set-motion" label="Reduce motion" desc={reduceMotionHelp(os)}>
          <ReduceMotionSwitch labelledBy="set-motion-label" describedBy="set-motion-desc" />
        </Row>
      </Group>

      <Group id="set-camera" title="Camera" index={3}>
        <Row id="set-camera-row" label="Camera demo" desc="Try the camera on any letter, outside a lesson.">
          <a className="set-btn" href="#/camera-demo" aria-label="Open the camera demo"><SlideLabel>Open</SlideLabel></a>
        </Row>
      </Group>

      <Group id="set-privacy" title="Privacy" index={4}>
        <Row id="set-privacy-row" label="What stays where" desc="Your names and progress stay in this browser. The coach receives letters and finger codes only, never names or video. Optional anonymous practice rows (letter/sign id, pass/fail, error codes, a random learner id) can go to Tiger Data when connected — never names or emails." />
      </Group>
    </div>
  );
}
