/**
 * Remotion 엔트리포인트 — registerRoot()
 * @remotion/bundler가 이 파일을 번들링한다.
 */

import { Composition, registerRoot } from "remotion";
import { Episode } from "./Episode.jsx";

const RemotionRoot = () => (
  <Composition
    id="Episode"
    component={Episode}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={2700}
    defaultProps={{
      beats: [],
      assets: [],
      subtitleCues: [],
      wordCues: [],
      audioPath: "",
      totalFrames: 2700,
    }}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.totalFrames || 2700,
    })}
  />
);

registerRoot(RemotionRoot);
