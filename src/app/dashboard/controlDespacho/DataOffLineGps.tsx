"use client";
import { useState, useEffect, useMemo } from "react";
import {
  AlertTriangle,
  MapPin,
  TrendingUp,
  Download,
  RefreshCw,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// Definir los tipos de las props
interface DataOffLineGpsProps {
  ruta: string;
  fecha: string;
  onDataSent?: () => void;
}

// Tipos TypeScript
interface GPSPoint {
  item: number;
  fecha: string;
  hora: string;
  speedKPH: number;
  longitude: number;
  latitude: number;
  odometerKM: number;
  address: string;
}

interface Geofence {
  id: number;
  name: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  active: boolean;
}

interface Detection {
  type: "entry" | "exit" | "pass_through" | "near_zone";
  fromPoint: GPSPoint;
  toPoint: GPSPoint;
  distanceFrom: number;
  distanceTo: number;
  minDistanceToCenter?: number;
  geofence: Geofence;
  confidence: "high" | "medium" | "low";
  timestamp: string;
  vehicleId: string;
  adaptiveRadius?: number; // Radio usado para la detección
  endTime?: string;
}

// interface DetectionResult {
//   geofence: Geofence;
//   detections: Detection[];
//   summary: {
//     total: number;
//     entries: number;
//     exits: number;
//     passThrough: number;
//     nearZone: number;
//   };
// }

interface APIResponse {
  listaTablas: GPSPoint[];
}

interface VehicleSchedule {
  vehicleId: string;
  codigo: number;
  startTime: string;
  endTime: string;
}

interface BatchAnalysisResult {
  vehicleId: string;
  codigo: number; // ← AGREGAR ESTO
  fechaini: string; // ← AGREGAR ESTO
  status: "detected" | "not_detected" | "error";
  detections: Detection[];
  error?: string;
  gpsPointsCount: number;
}

interface APIVehicleData {
  codigo: number;
  deviceID: string;
  fechaini: string;
  fechafin: string;
}

interface APIDataItem {
  codasig: string;
  deviceID: string;
  nom_control: string;
  hora_inicio: string;
  hora_estimada: string;
  hora_llegada: string;
  volado: string;
  fecha: string;
}

// Modificar la función para recibir las props con tipos
export default function DataOffLineGps({
  ruta,
  fecha,
  onDataSent,
}: DataOffLineGpsProps) {
  const [open, setOpen] = useState(false);

  const getStaticMinutesForRoute11 = (): number[] => {
    // IDA: PAMPAS(5), CT(34), PARAISO(41), LOZA(3), MANANTIAL(2)
    return [5, 39, 80, 83, 85];
  };

  // Función estática para obtener minutos de la ruta 12 (REGRESO: VMT - Chorrillos)
  const getStaticMinutesForRoute12 = (): number[] => {
    // REGRESO: LOZA(2), PARAÍSO(3), MAMARA(14), ATAUCUSI(56), SAN JOSE II(5)
    return [2, 5, 19, 75, 80];
  };
  const adjustTimeForLargeRadius = (
    timeString: string,
    adaptiveRadius?: number,
  ): string => {
    let secondsToSubtract = 0;

    switch (adaptiveRadius) {
      case 10:
        secondsToSubtract = 40; // 0:40
        break;
      case 20:
      case 30:
      case 40:
        secondsToSubtract = 45; // 0:45
        break;
      case 50:
        secondsToSubtract = 30; // 0:30
        break;
      case 100:
        secondsToSubtract = 90; // 1:30
        break;
      case 200:
        secondsToSubtract = 150; // 2:30
        break;
      case 300:
        secondsToSubtract = 140; // 2:20
        break;
      case 400:
        secondsToSubtract = 180; // 3:00
        break;
      case 500:
        secondsToSubtract = 240; // 4:00
        break;
      default:
        return timeString; // no ajuste
    }

    const [hours, minutes, seconds] = timeString.split(":").map(Number);
    let totalSeconds = hours * 3600 + minutes * 60 + seconds;

    totalSeconds -= secondsToSubtract;

    // Evitar tiempos negativos
    if (totalSeconds < 0) totalSeconds = 0;

    const adjustedHours = Math.floor(totalSeconds / 3600);
    const adjustedMinutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${adjustedHours.toString().padStart(2, "0")}:${adjustedMinutes
      .toString()
      .padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const calculateTimeDifference = (
    startTime: string,
    endTime: string,
  ): string => {
    const timeToSeconds = (time: string): number => {
      const parts = time.split(":").map(Number);
      const hours = parts[0] || 0;
      const minutes = parts[1] || 0;
      const seconds = parts[2] || 0;
      return hours * 3600 + minutes * 60 + seconds;
    };

    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);

    const rawDifference = endSeconds - startSeconds;
    const isNegative = rawDifference < 0;
    const differenceSeconds = Math.abs(rawDifference);

    const hours = Math.floor(differenceSeconds / 3600);
    const minutes = Math.floor((differenceSeconds % 3600) / 60);
    const seconds = differenceSeconds % 60;

    let result = "";
    if (hours > 0) {
      result = `${hours}h ${minutes}min ${seconds}seg`;
    } else if (minutes > 0) {
      result = `${minutes}min ${seconds}seg`;
    } else {
      result = `${seconds}seg`;
    }

    return isNegative ? `-${result}` : result;
  };

  const calculateEndTime = (
    startTime: string,
    minutesToAdd: number,
  ): string => {
    const [hours, minutes] = startTime.split(":").map(Number);
    const totalMinutes = hours * 60 + minutes + minutesToAdd;
    const endHours = Math.floor(totalMinutes / 60);
    const endMinutes = totalMinutes % 60;
    return `${endHours.toString().padStart(2, "0")}:${endMinutes
      .toString()
      .padStart(2, "0")}`;
  };

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState<boolean>(false);
  const [batchResults, setBatchResults] = useState<BatchAnalysisResult[]>([]);

  useEffect(() => {
    if (open) {
      // Cuando el modal se abre, reinicia los estados
      setBatchResults([]);
      setBatchLoading(false);
    }
  }, [open]);

  // NUEVO: Estados para manejar la API de horarios
  const [vehicleSchedules, setVehicleSchedules] = useState<VehicleSchedule[]>(
    [],
  );
  const [loadingSchedules, setLoadingSchedules] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(fecha);
  const [selectedRoute, setSelectedRoute] = useState<string>(ruta);

  useEffect(() => {
    setSelectedRoute(ruta);
    setSelectedDate(fecha);
  }, [ruta, fecha]);

  // 7 GEOCERCAS FIJAS
  const getGeofencesByRoute = (route: string): Geofence[] => {
  if (route === "11") {
    // ════════════════════════════════════════════════════════════
    // GEOCERCAS DE IDA (1-5) - Código 11
    // ════════════════════════════════════════════════════════════
    return [
      {
        id: 1,
        name: "PAMPAS",
        centerLat: -12.194341,
        centerLon: -77.026271,
        radius: 10,
        active: true,
      },
      {
        id: 2,
        name: "CT",
        centerLat: -12.165470,
        centerLon: -76.973303,
        radius: 10,
        active: true,
      },
      {
        id: 3,
        name: "PARAISO IDA",
        centerLat: -12.147672,
        centerLon: -76.932137,
        radius: 10,
        active: true,
      },
      {
        id: 4,
        name: "LOZA IDA",
        centerLat: -12.144031,
        centerLon: -76.924957,
        radius: 10,
        active: true,
      },
      {
        id: 5,
        name: "MANANTIAL",
        centerLat: -12.140487,
        centerLon: -76.923778,
        radius: 10,
        active: true,
      },
    ];
  } else if (route === "12") {
    // ════════════════════════════════════════════════════════════
    // GEOCERCAS DE REGRESO (6-10) - Código 12
    // ════════════════════════════════════════════════════════════
    return [
      {
        id: 6,
        name: "LOZA VUELTA",
        centerLat: -12.144031,
        centerLon: -76.924957,
        radius: 10,
        active: true,
      },
      {
        id: 7,
        name: "PARAISO VUELTA",
        centerLat: -12.146782,
        centerLon: -76.929376,
        radius: 10,
        active: true,
      },
      {
        id: 8,
        name: "MAMARA",
        centerLat: -12.148470,
        centerLon: -76.948015,
        radius: 10,
        active: true,
      },
      {
        id: 9,
        name: "ATAUCUSI",
        centerLat: -12.195950,
        centerLon: -77.023812,
        radius: 10,
        active: true,
      },
      {
        id: 10,
        name: "SAN JOSE II",
        centerLat: -12.189716,
        centerLon: -77.023175,
        radius: 10,
        active: true,
      },
    ];
  } else {
    // Por defecto, usar las geocercas de ruta 11
    return getGeofencesByRoute("11");
  }
};

  const geofences: Geofence[] = useMemo(
    () => getGeofencesByRoute(selectedRoute),
    [selectedRoute],
  );

  useEffect(() => {
    // Limpiar resultados cuando cambie la ruta o fecha
    setBatchResults([]);
  }, [selectedRoute, selectedDate]);

  // NUEVA FUNCIÓN: Cargar horarios desde la API
  const loadVehicleSchedules = async (): Promise<void> => {
    setLoadingSchedules(true);
    setError(null);

    try {
      const url = `https://villa.velsat.pe:8443/api/Datero/GPSUniDespEdu?fecha=${selectedDate}&ruta=${selectedRoute}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Error HTTP ${response.status}: No se pudieron cargar los horarios`,
        );
      }

      const apiData: APIVehicleData[] = await response.json();

      if (!apiData || apiData.length === 0) {
        throw new Error(
          "No se encontraron vehículos para la fecha y ruta seleccionadas",
        );
      }

      // Convertir los datos de la API al formato VehicleSchedule
      const schedules: VehicleSchedule[] = apiData.map((item) => ({
        vehicleId: item.deviceID,
        codigo: item.codigo,
        startTime: item.fechaini,
        endTime: item.fechafin,
      }));

      setVehicleSchedules(schedules);

      // Limpiar resultados anteriores
      setBatchResults([]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al cargar los horarios de vehículos",
      );
      setVehicleSchedules([]);
    } finally {
      setLoadingSchedules(false);
    }
  };

  // Cargar horarios al montar el componente y cuando cambien ruta o fecha
  useEffect(() => {
    loadVehicleSchedules();
  }, [selectedDate, selectedRoute]);

  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number => {
    const R = 6371000; // Radio de la Tierra en metros
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const distanceFromPointToLine = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number => {
    const centerLat = (y1 + y2) / 2;
    const metersPerDegreeLat = 111000;
    const metersPerDegreeLon = 111000 * Math.cos((centerLat * Math.PI) / 180);

    const pxMeters = px * metersPerDegreeLon;
    const pyMeters = py * metersPerDegreeLat;
    const x1Meters = x1 * metersPerDegreeLon;
    const y1Meters = y1 * metersPerDegreeLat;
    const x2Meters = x2 * metersPerDegreeLon;
    const y2Meters = y2 * metersPerDegreeLat;

    const A = pxMeters - x1Meters;
    const B = pyMeters - y1Meters;
    const C = x2Meters - x1Meters;
    const D = y2Meters - y1Meters;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    if (lenSq === 0) return Math.sqrt(A * A + B * B);

    let param = dot / lenSq;
    param = Math.max(0, Math.min(1, param));

    const xx = x1Meters + param * C;
    const yy = y1Meters + param * D;

    const dx = pxMeters - xx;
    const dy = pyMeters - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const analyzeTrajectoryIntersection = (
    gpsPoints: GPSPoint[],
    geofence: Geofence,
    vehicleId: string,
  ): Detection[] => {
    const detections: Detection[] = [];

    for (let i = 0; i < gpsPoints.length - 1; i++) {
      const p1 = gpsPoints[i];
      const p2 = gpsPoints[i + 1];

      if (!p1 || !p2) continue;

      const d1 = calculateDistance(
        geofence.centerLat,
        geofence.centerLon,
        p1.latitude,
        p1.longitude,
      );
      const d2 = calculateDistance(
        geofence.centerLat,
        geofence.centerLon,
        p2.latitude,
        p2.longitude,
      );

      // NUEVA LÓGICA: Elegir el punto más cercano al centro para el timestamp
      const closestPoint = d1 <= d2 ? p1 : p2;
      const closestTimestamp = closestPoint.fecha + " " + closestPoint.hora;

      if (
        (d1 <= geofence.radius && d2 > geofence.radius) ||
        (d1 > geofence.radius && d2 <= geofence.radius)
      ) {
        detections.push({
          type: d1 <= geofence.radius ? "exit" : "entry",
          fromPoint: p1,
          toPoint: p2,
          distanceFrom: Math.round(d1),
          distanceTo: Math.round(d2),
          geofence: geofence,
          confidence: "high",
          timestamp: closestTimestamp, // ← USAR EL PUNTO MÁS CERCANO
          vehicleId: vehicleId,
        });
      } else if (d1 > geofence.radius && d2 > geofence.radius) {
        const minDistance = distanceFromPointToLine(
          geofence.centerLon,
          geofence.centerLat,
          p1.longitude,
          p1.latitude,
          p2.longitude,
          p2.latitude,
        );

        if (minDistance <= geofence.radius) {
          detections.push({
            type: "pass_through",
            fromPoint: p1,
            toPoint: p2,
            distanceFrom: Math.round(d1),
            distanceTo: Math.round(d2),
            minDistanceToCenter: Math.round(minDistance),
            geofence: geofence,
            confidence: "medium",
            timestamp: closestTimestamp, // ← USAR EL PUNTO MÁS CERCANO
            vehicleId: vehicleId,
          });
        }
      } else if (d1 <= geofence.radius * 1.2 || d2 <= geofence.radius * 1.2) {
        if (d1 <= geofence.radius || d2 <= geofence.radius) {
          detections.push({
            type: "near_zone",
            fromPoint: p1,
            toPoint: p2,
            distanceFrom: Math.round(d1),
            distanceTo: Math.round(d2),
            geofence: geofence,
            confidence: "high",
            timestamp: closestTimestamp, // ← USAR EL PUNTO MÁS CERCANO
            vehicleId: vehicleId,
          });
        }
      }
    }

    return detections;
  };

  const getBestDetection = (detections: Detection[]): Detection | undefined => {
    if (detections.length === 0) return undefined;
    if (detections.length === 1) return detections[0];

    let bestDetection = detections[0];
    let bestScore = -1;

    detections.forEach((detection) => {
      // NUEVA LÓGICA: Calcular qué tan cerca está del centro de la geocerca
      const minDistanceToCenter = Math.min(
        detection.distanceFrom,
        detection.distanceTo,
      );

      // Puntuación basada en cercanía al centro (mientras más cerca, mejor puntuación)
      const proximityScore = Math.max(0, 100 - minDistanceToCenter); // 100 puntos si está a 0m, 0 puntos si está a 100m+

      // Bonificación por tipo de detección (entry/exit son más confiables que pass_through)
      const typeScore = (() => {
        switch (detection.type) {
          case "entry":
            return 20;
          case "exit":
            return 18;
          case "near_zone":
            return 15;
          case "pass_through":
            return 10;
          default:
            return 0;
        }
      })();

      // Puntuación total (prioriza cercanía al centro)
      const totalScore = proximityScore + typeScore;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestDetection = detection;
      }
    });

    return bestDetection;
  };

  const analyzeWithAdaptiveRadius = (
    gpsPoints: GPSPoint[],
    geofence: Geofence,
    vehicleId: string,
  ): { detection: Detection | undefined; usedRadius: number } => {
    const radiusSteps = [10, 20, 30, 40, 50, 100, 200, 300, 400, 500]; // Incrementos de 10m hasta máximo 500m

    for (const radius of radiusSteps) {
      const adaptedGeofence = { ...geofence, radius };
      const detections = analyzeTrajectoryIntersection(
        gpsPoints,
        adaptedGeofence,
        vehicleId,
      );
      const bestDetection = getBestDetection(detections);

      if (bestDetection) {
        // Marcar que se usó un radio adaptado
        const adaptedDetection = {
          ...bestDetection,
          geofence: adaptedGeofence,
          adaptiveRadius: radius,
        };
        return { detection: adaptedDetection, usedRadius: radius };
      }
    }

    return { detection: undefined, usedRadius: 10 };
  };

  const analyzeVehicle = async (
    vehicle: VehicleSchedule,
  ): Promise<BatchAnalysisResult> => {
    try {
      const startDate = `${fecha}T${vehicle.startTime}`;
      const endDate = `${fecha}T${vehicle.endTime}`;
      const url = `https://villa.velsat.pe:8443/api/Reporting/general/${startDate}/${endDate}/${vehicle.vehicleId}/etudv22`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return {
          vehicleId: vehicle.vehicleId,
          codigo: vehicle.codigo,
          fechaini: vehicle.startTime,
          status: "error",
          error: `HTTP ${response.status}`,
          gpsPointsCount: 0,
          detections: [],
        };
      }

      const data: APIResponse = await response.json();

      if (!data || !data.listaTablas || data.listaTablas.length === 0) {
        return {
          vehicleId: vehicle.vehicleId,
          codigo: vehicle.codigo,
          fechaini: vehicle.startTime,
          status: "not_detected",
          gpsPointsCount: 0,
          detections: [],
        };
      }

      const allDetections: Detection[] = [];
      geofences.forEach((geofence) => {
        const { detection } = analyzeWithAdaptiveRadius(
          data.listaTablas,
          geofence,
          vehicle.vehicleId,
        );
        if (detection) {
          allDetections.push(detection);
        }
      });

      if (allDetections.length > 0) {
        const [startHours, startMinutes] = vehicle.startTime
          .split(":")
          .map(Number);

        // DESPUÉS (con valores estáticos):
        const staticMinutes =
          selectedRoute === "11"
            ? getStaticMinutesForRoute11()
            : getStaticMinutesForRoute12();

        allDetections.forEach((detection) => {
          const geofenceIndex = geofences.findIndex(
            (g) => g.id === detection.geofence.id,
          );

          if (geofenceIndex !== -1 && geofenceIndex < staticMinutes.length) {
            detection.endTime = calculateEndTime(
              vehicle.startTime,
              staticMinutes[geofenceIndex],
            );
          }
        });
      }

      return {
        vehicleId: vehicle.vehicleId,
        codigo: vehicle.codigo,
        fechaini: vehicle.startTime,
        status: allDetections.length > 0 ? "detected" : "not_detected",
        detections: allDetections,
        gpsPointsCount: data.listaTablas.length,
      };
    } catch (err) {
      return {
        vehicleId: vehicle.vehicleId,
        codigo: vehicle.codigo,
        fechaini: vehicle.startTime,
        status: "error",
        error: err instanceof Error ? err.message : "Error desconocido",
        gpsPointsCount: 0,
        detections: [],
      };
    }
  };

  const analyzeBatchVehicles = async (): Promise<void> => {
    if (vehicleSchedules.length === 0) {
      setError("No hay vehículos cargados. Cargando datos...");
      await loadVehicleSchedules();
      return;
    }

    setBatchLoading(true);
    setBatchResults([]);
    setError(null);

    try {
      const results: BatchAnalysisResult[] = [];

      for (let i = 0; i < vehicleSchedules.length; i += 3) {
        const batch = vehicleSchedules.slice(i, i + 3);

        const batchPromises = batch.map((vehicle) => analyzeVehicle(vehicle));
        const batchResults = await Promise.all(batchPromises);

        results.push(...batchResults);
        setBatchResults([...results]);

        if (i + 3 < vehicleSchedules.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en análisis masivo");
    } finally {
      setBatchLoading(false);
    }
  };

  const sendDataToAPI = async (): Promise<void> => {
    if (batchResults.length === 0) {
      setError("No hay datos para enviar. Realiza primero el análisis.");
      toast.error("No hay datos para enviar. Realiza primero el análisis.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const apiData: APIDataItem[] = [];
      const vehiclesWithDetections = batchResults.filter(
        (r) => r.detections.length > 0,
      );

      vehiclesWithDetections.forEach((result) => {
        result.detections.forEach((detection) => {
          const originalArrivalTime = detection.timestamp.split(" ")[1];
          const adjustedArrivalTime = adjustTimeForLargeRadius(
            originalArrivalTime,
            detection.adaptiveRadius,
          );
          apiData.push({
            codasig: result.codigo.toString(),
            deviceID: result.vehicleId,
            nom_control: detection.geofence.name,
            hora_inicio: result.fechaini,
            hora_estimada: detection.endTime || "",
            hora_llegada: adjustedArrivalTime,
            volado: calculateTimeDifference(
              detection.endTime || "",
              adjustedArrivalTime,
            ),

            fecha: fecha,
          });
        });
      });

      const response = await fetch(
        "https://villa.velsat.pe:8443/api/Datero/EnvioControlB/etudv22",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(apiData),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Error HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const responseData = await response.json();

      toast.success(
        `Datos enviados exitosamente. ${apiData.length} registros enviados.`,
      );
      console.log("Respuesta de la API:", responseData);

      setTimeout(() => {
        setOpen(false);
        if (onDataSent) {
          onDataSent();
        }
      }, 500);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Error desconocido al enviar datos";
      setError(`Error al enviar datos a la API: ${errorMessage}`);
      console.error("Error enviando datos:", err);
      toast.error(`❌ Error al enviar datos: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-md bg-green-700 px-4 py-[11px] text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-green-700/90 focus:outline-none dark:text-white"
      >
        Cargar Data Offline
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[90vw] max-w-none border-0 shadow-2xl bg-white/95 backdrop-blur-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              CARGAR DATA OFFLINE : UNIDAD DE VILLA -{" "}
              {ruta === "11"
                ? "Chorrillos - VMT"
                : ruta === "12"
                  ? "VMT - Chorrillos"
                  : `Ruta ${ruta}`}{" "}
              ({fecha})
            </DialogTitle>
          </DialogHeader>

          {/* <div className="mt-4 p-3 bg-gray-100 rounded">
            <p className="font-medium">Datos recibidos:</p>
            <p className="text-sm">Ruta: {ruta}</p>
            <p className="text-sm">Ruta: {fecha}</p>
          </div> */}

          <div>
            <div className="p-0">
              <div>
                {/* Panel de Geocercas Fijas */}
                <div className="bg-white rounded-xl shadow-lg p-2 mb-2">
                  <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <MapPin className="text-green-600" />
                    Geocercas Configuradas
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {geofences.map((geofence) => (
                      <div
                        key={geofence.id}
                        className="border border-gray-200 rounded-lg p-2 bg-green-50"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-medium text-gray-800 text-xs">
                            {geofence.name}
                          </h3>
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            35m
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          <div>Lat: {geofence.centerLat.toFixed(6)}</div>
                          <div>Lon: {geofence.centerLon.toFixed(6)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Análisis Masivo */}
                <div className="bg-white rounded-xl shadow-lg p-2 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold flex items-center">
                      Análisis masivo del datero en modo apagado
                    </h2>
                  </div>

                  {/* Guía paso a paso */}
                  <div className="mb-4 p-2 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded text-sm">
                    {batchResults.length === 0 && !batchLoading ? (
                      <>
                        👆 <strong>Paso 1:</strong> Haz clic en{" "}
                        <span className="font-semibold text-purple-700">
                          “Analizar datos”
                        </span>{" "}
                        para iniciar el análisis.
                      </>
                    ) : batchLoading ? (
                      <>⏳ Análisis en progreso… por favor espera.</>
                    ) : batchResults.length === vehicleSchedules.length ? (
                      <>
                        ✅ Análisis completado. 👇 <strong>Paso 2:</strong> Haz
                        clic en{" "}
                        <span className="font-semibold text-green-700">
                          “Cargar datos al despacho”
                        </span>{" "}
                        para enviar los resultados.
                      </>
                    ) : (
                      <>
                        🔍 Analizando {batchResults.length} /{" "}
                        {vehicleSchedules.length} datos…
                      </>
                    )}
                  </div>

                  {/* Botón Analizar */}
                  <div className="flex gap-3 mb-2">
                    <button
                      onClick={analyzeBatchVehicles}
                      disabled={
                        batchLoading ||
                        loadingSchedules ||
                        vehicleSchedules.length === 0 ||
                        batchResults.length === vehicleSchedules.length
                      }
                      className={`px-6 py-2 rounded-lg font-medium flex items-center gap-2
        ${
          batchResults.length === vehicleSchedules.length
            ? "bg-gray-400"
            : "bg-purple-600 hover:bg-purple-700"
        }
        text-white
      `}
                    >
                      {batchLoading || loadingSchedules ? (
                        <RefreshCw className="animate-spin h-5 w-5" />
                      ) : (
                        <TrendingUp className="h-5 w-5" />
                      )}
                      {batchLoading
                        ? "Analizando..."
                        : loadingSchedules
                          ? "Cargando vehículos..."
                          : vehicleSchedules.length === 0
                            ? "Sin vehículos"
                            : `Analizar datos`}
                    </button>
                  </div>

                  {/* Progreso */}
                  {batchLoading && (
                    <div className="mb-4 bg-blue-50 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-blue-800">
                          Progreso del análisis
                        </span>
                        <span className="text-sm text-blue-600">
                          {batchResults.length} / {vehicleSchedules.length}
                        </span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              (batchResults.length / vehicleSchedules.length) *
                              100
                            }%`,
                          }}
                        ></div>
                      </div>
                    </div>
                  )}

                  {/* Botón Cargar Datos */}
                  <div className="flex justify-end">
                    <button
                      onClick={sendDataToAPI}
                      disabled={
                        loading ||
                        batchLoading ||
                        batchResults.length !== vehicleSchedules.length
                      }
                      className={`w-full px-4 py-4 rounded-lg text-sm font-medium flex items-center justify-center gap-2
        ${
          batchResults.length === vehicleSchedules.length
            ? "bg-green-600 hover:bg-green-700"
            : "bg-gray-400"
        }
        text-white
      `}
                    >
                      {loading ? (
                        <svg
                          className="animate-spin h-4 w-4 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                          />
                        </svg>
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {loading ? "Enviando..." : "CARGAR DATOS AL DESPACHO"}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
                    <div className="flex items-center gap-2 text-red-800">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-medium">Error:</span> {error}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button className="px-4 py-2 rounded-md bg-red-600 text-gray-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2">
                Cerrar
              </button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
