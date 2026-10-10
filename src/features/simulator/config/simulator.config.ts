export const CAMERA_MODES = ['chase', 'bonnet', 'driver', 'dickey', 'overview'] as const;

export type CameraMode = (typeof CAMERA_MODES)[number];
export type ActiveCameraMode = CameraMode | 'reverse';

export const SIMULATOR_CONFIG = {
  world: {
    background: '#92c7f4',
    fogColor: '#92c7f4',
    fogNear: 65,
    fogFar: 320,
  },
  /** Environment settings used when a GeoJSON route world is active instead of the city GLB. */
  routeWorld: {
    background: '#9ccdf2',
    fogColor: '#9ccdf2',
    fogNear: 160,
    fogFar: 760,
  },
  vehicle: {
    acceleration: 28,
    aerodynamicDrag: 0.0066,
    bodyLean: 0.18,
    brakeStrength: 34,
    maxForwardSpeed: 80,
    maxReverseSpeed: 12,
    collisionProbeHeight: 0.9,
    collisionProbeLength: 1.5,
    collisionRadius: 1.05,
    /**
     * Lateral acceleration cap (m/s²). Yaw rate is limited so that `speed * yawRate` never
     * exceeds this, which stops the kinematic model from spinning at motorway speeds.
     */
    maxLateralAcceleration: 8.5,
    modelYawOffset: 0,
    orientationLerp: 9,
    reverseAcceleration: 11,
    rideHeight: 0.62,
    rollingResistance: 1.2,
    steerResponse: 11,
    /**
     * Speed (m/s) at which the available steering angle is halved. Steering authority
     * falls off as `1 / (1 + speed / steerSpeedSoftening)`.
     */
    steerSpeedSoftening: 14,
    trackWidth: 1.72,
    /** Yaw rate per unit of steering per m/s. Full lock at walking pace turns in roughly 6.5 m. */
    turnGrip: 0.18,
    visualFootprint: 4.65,
    wheelBase: 2.8,
    maxSteerAngle: 0.88,
    boostMultiplier: 1.22,
  },
  camera: {
    chase: {
      accelerationPositionOffset: [0, 0.12, -0.85] as const,
      baseFov: 56,
      followDamping: 7.2,
      localLookOffset: [0, 1.05, 4.9] as const,
      localPositionOffset: [0, 2.45, -6.6] as const,
      speedPositionOffset: [0, 0.45, -3.2] as const,
    },
    bonnet: {
      accelerationPositionOffset: [0, 0, 0] as const,
      baseFov: 68,
      followDamping: 11,
      localLookOffset: [0, 1.02, 14] as const,
      localPositionOffset: [0, 1.08, 2.02] as const,
      speedPositionOffset: [0, 0, 0] as const,
    },
    driver: {
      accelerationPositionOffset: [0, 0, 0] as const,
      baseFov: 74,
      followDamping: 11,
      localLookOffset: [0.18, 1.14, 14] as const,
      localPositionOffset: [0.18, 1.12, 0.22] as const,
      speedPositionOffset: [0, 0, 0] as const,
    },
    dickey: {
      accelerationPositionOffset: [0, 0.18, -1.8] as const,
      baseFov: 64,
      followDamping: 8,
      localLookOffset: [0, 1.1, 10] as const,
      localPositionOffset: [0, 1.72, -3.9] as const,
      speedPositionOffset: [0, 0.26, -3.1] as const,
    },
    overview: {
      accelerationPositionOffset: [0, 0, 0] as const,
      baseFov: 52,
      followDamping: 4.5,
      localLookOffset: [0, 0.8, 4] as const,
      localPositionOffset: [0, 17, -15] as const,
      speedPositionOffset: [0, 0, 0] as const,
    },
    /**
     * Reversing view. The camera stays behind the car (same side as the chase camera) and
     * looks at the ground behind the rear bumper. Keeping it on the same side means screen
     * left/right stays the car's left/right, so steering never appears mirrored.
     */
    reverse: {
      accelerationPositionOffset: [0, 0, 0] as const,
      baseFov: 60,
      followDamping: 6.2,
      localLookOffset: [0, 0.5, -4.5] as const,
      localPositionOffset: [0, 3.6, -8.2] as const,
      speedPositionOffset: [0, 0, 0] as const,
    },
  },
  /** How GeoJSON routes from `public/routes` are turned into a drivable world. */
  route: {
    /** Vertices within this distance (m) of an earlier part of the route share one carriageway. */
    mergeDistance: 6,
    road: {
      arrowSpacing: 140,
      asphaltHalfWidth: 3.5,
      cornerRadius: 8,
      dashGap: 6,
      dashLength: 3,
      edgeLineOffset: 3.25,
      /** Lateral offset (m, right of the centreline) of the driving lane centre. Georgia drives on the right. */
      laneOffset: 1.75,
      lineWidth: 0.12,
      minVertexSpacing: 2.5,
      sampleStep: 8,
      shoulderHalfWidth: 4.15,
    },
    scenery: {
      backgroundTreeCount: 450,
      groundMargin: 650,
      lampOffset: 5.1,
      lampSpacing: 48,
      roadsideTreeSpacing: 26,
      seed: 1337,
      treeClearance: 13,
    },
  },
  /**
   * Exam session thresholds. These are simulator tolerances, not official Georgian exam
   * scoring rules; the default urban speed limit is configurable here.
   */
  exam: {
    collisionCooldownSeconds: 3,
    finishDistance: 12,
    finishSpeedKph: 3,
    offRouteDistance: 7.5,
    offRouteSeconds: 1.2,
    speedLimitKph: 60,
    speedingSeconds: 2,
    speedingToleranceKph: 4,
    trackerLookaheadMeters: 160,
    wrongLaneOffset: 1,
    wrongLaneSeconds: 2.5,
    wrongWaySeconds: 2.5,
  },
} as const;

export type RouteRoadConfig = typeof SIMULATOR_CONFIG.route.road;
export type RouteSceneryConfig = typeof SIMULATOR_CONFIG.route.scenery;
export type ExamConfig = typeof SIMULATOR_CONFIG.exam;
