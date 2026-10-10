import motorcycleThumbnail from '../../../shared/assets/garage-thumbnails/motorcycle.png';
import muscleCoupeThumbnail from '../../../shared/assets/garage-thumbnails/muscle-coupe.png';
import offroadJeepThumbnail from '../../../shared/assets/garage-thumbnails/offroad-jeep.png';
import policeSedanThumbnail from '../../../shared/assets/garage-thumbnails/police-sedan.png';
import sportsCoupeThumbnail from '../../../shared/assets/garage-thumbnails/sports-coupe.png';
import suvThumbnail from '../../../shared/assets/garage-thumbnails/suv.png';
import tunerCoupeThumbnail from '../../../shared/assets/garage-thumbnails/tuner-coupe.png';

interface VehicleCardPreviewProps {
  paintColor: string;
  vehicleId: string;
}

const THUMBNAIL_BY_VEHICLE_ID: Record<string, string> = {
  '1970-chevrolet-camaro-z28': muscleCoupeThumbnail,
  '1970-chevrolet-chevelle-ss-454': muscleCoupeThumbnail,
  '1970-dodge-challenger-rt': muscleCoupeThumbnail,
  '1992-honda-nsx-r': sportsCoupeThumbnail,
  '1993-honda-civic-coupe-vis-racing-fast-furious': tunerCoupeThumbnail,
  '2012-dodge-charger-rt-sedan-4d': muscleCoupeThumbnail,
  '2013-dodge-charger-srt8-patrol': policeSedanThumbnail,
  '2013-jeep-grand-cherokee-srt8': suvThumbnail,
  '2019-jeep-cherokee': suvThumbnail,
  '2021-jeep-grand-commander-k8': suvThumbnail,
  'free-porsche-911-carrera-4s': sportsCoupeThumbnail,
  'honda-rc181-hailwood-1966-www-vecarz-com': motorcycleThumbnail,
  'jeep-gladiator': offroadJeepThumbnail,
  'jeep-wrangler-adventure-rubicon-www-vecarz-com': offroadJeepThumbnail,
  'ringbrothers-1966-chevrolet-chevelle-recoil': muscleCoupeThumbnail,
};

function getVehicleCardThumbnail(vehicleId: string) {
  return THUMBNAIL_BY_VEHICLE_ID[vehicleId] ?? sportsCoupeThumbnail;
}

export function VehicleCardPreview({ paintColor: _paintColor, vehicleId }: VehicleCardPreviewProps) {
  return <img src={getVehicleCardThumbnail(vehicleId)} alt="" draggable={false} className="garage-panel__card-image" />;
}
