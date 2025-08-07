import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Chart from "chart.js/auto";
import zoomPlugin from "chartjs-plugin-zoom";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import {
  SendHorizonal,
  Download,
  Paperclip,
  ImageIcon,
  Trash2,
  Globe,
  MapPin,
  MoreVertical,
} from "lucide-react";
import jsPDF from "jspdf";
import { Share2 } from "lucide-react";
import html2canvas from "html2canvas";
import leafletImage from "leaflet-image";
import ChartDataLabels from "chartjs-plugin-datalabels";

Chart.register(zoomPlugin, ChartDataLabels);

// Debounce hook delays updating value until stable for delay ms
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const ELEVENLABS_API_KEY = "sk_f93511d1abe277fc25ba8ce310fde9be0115c8cac6e06c7c";
const ELEVENLABS_VOICE_ID = "wAGzRVkxKEs8La0lmdrE";

// Helper to speak text using ElevenLabs API ONLY
const playElevenLabsTTS = async (text: string) => {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          voice_settings: { stability: 0.5, similarity_boost: 0.5 },
        }),
      }
    );
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    await audio.play();
    return new Promise((resolve) => {
      audio.onended = resolve;
    });
  } catch (err) {
    console.error("ElevenLabs TTS error:", err);
    throw err; // Don't fall back to browser TTS
  }
};

const showToast = (msg: string) => {
  const toast = document.createElement("div");
  toast.innerText = msg;
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.left = "50%";
  toast.style.transform = "translateX(-50%)";
  toast.style.background = "#2563eb";
  toast.style.color = "#fff";
  toast.style.padding = "12px 24px";
  toast.style.borderRadius = "8px";
  toast.style.fontSize = "1rem";
  toast.style.zIndex = "9999";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1700);
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost";
  className?: string;
};

const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = "default",
  ...props
}) => {
  const baseClasses =
    "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  const variants: Record<string, string> = {
    default: "bg-blue-600 text-white hover:bg-blue-700",
    ghost: "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200",
  };
  const finalClassName = `${baseClasses} ${variants[variant]} ${className || ""}`;
  return (
    <button className={finalClassName} {...props}>
      {children}
    </button>
  );
};

const ChartContainer: React.FC<{ children: React.ReactNode; dataLength: number; className?: string }> = ({
  children,
  dataLength,
  className = "",
}) => {
  const itemWidth = 80;
  const minWidth = dataLength * itemWidth;
  return (
    <div
      className={`overflow-x-auto w-full h-[500px] bg-white dark:bg-gray-700 rounded-lg border p-2 flex flex-col relative ${className}`}
    >
      <div style={{ minWidth, height: "100%" }} className="flex-grow relative">
        {children}
      </div>
    </div>
  );
};

// Pie Chart Legend Component
const PieChartLegend: React.FC<{ data: any[]; timestamp: string }> = ({ data, timestamp }) => {
  const colorPalette = [
    "#3b82f6", "#f97316", "#14b8a6", "#ef4444", "#8b5cf6", "#eab308", "#6b7280",
  ];
  
  const total = data.reduce((sum, item) => sum + (item.value || 0), 0);
  
  return (
    <div className="w-full bg-white dark:bg-gray-700 rounded-lg border p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Chart Legend</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {new Date(timestamp).toLocaleDateString()}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.map((item, index) => {
          const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
          return (
            <div key={index} className="flex items-center space-x-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-600">
              <div 
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: colorPalette[index % colorPalette.length] }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {item.label || item.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {item.value} ({percentage}%)
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

type ChartDataItem =
  | { type: "user" | "text" | "error"; data: string; timestamp: string }
  | { type: string; data: any; timestamp: string }; // for chart/map types

const ReportDashboard: React.FC = () => {
  // State for voice and chat
  const [awaitingMoreQuestion, setAwaitingMoreQuestion] = useState(false);
  const [speechTimeout, setSpeechTimeout] = useState<NodeJS.Timeout | null>(null);
  const [chartDataList, setChartDataList] = useState<ChartDataItem[]>(() => {
    const stored = localStorage.getItem("chartDataList");
    return stored ? JSON.parse(stored) : [];
  });
  const [userInput, setUserInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  
  // Speech recognition
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition();

  const debouncedSpeech = useDebounce<string>(transcript, 800); // Reduced delay for better responsiveness

  // Refs
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRefs = useRef<Map<number, L.Map>>(new Map());
  const leafletMarkersRefs = useRef<Map<number, L.CircleMarker[]>>(new Map());
  const chartJsInstances = useRef<Map<number, Chart>>(new Map());
  const optionsDropdownRef = useRef<HTMLDivElement | null>(null);
  
  // UI State
  const [currentMapDisplayMode, setCurrentMapDisplayMode] = useState<"india" | "world">("india");
  const [showOptionsDropdown, setShowOptionsDropdown] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  
  const token = localStorage.getItem("token") || "mock-token-for-testing";

  // Utility functions
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    if (hour < 22) return "Good evening";
    return "Good night";
  };

  // Handler for voice button - IMPROVED
  const handleVoiceButtonClick = async () => {
    if (!browserSupportsSpeechRecognition) {
      showToast("Speech recognition not supported in this browser");
      return;
    }

    if (listening) {
      SpeechRecognition.stopListening();
      setAwaitingMoreQuestion(false);
      resetTranscript();
      return;
    }

    try {
      resetTranscript();
      setUserInput("");
      
      const greeting = `${getGreeting()}. Hello! I am your AI health assistant. How can I help you today?`;
      await playElevenLabsTTS(greeting);
      
      // Start listening with better configuration
      await SpeechRecognition.startListening({ 
        continuous: true,
        language: 'en-US'
      });
      
      setAwaitingMoreQuestion(true);
      showToast("Listening... Speak now!");
      
    } catch (error) {
      console.error("Voice recognition error:", error);
      showToast("Failed to start voice recognition");
    }
  };

  // IMPROVED: Handle speech recognition with better logic
  useEffect(() => {
    if (listening && debouncedSpeech.trim() && debouncedSpeech !== userInput) {
      const lower = debouncedSpeech.trim().toLowerCase();
      
      // Handle stop commands
      if (awaitingMoreQuestion && ["no", "no more", "no thanks", "that's all", "stop", "enough"].includes(lower)) {
        playElevenLabsTTS("Okay, have a great day!");
        SpeechRecognition.stopListening();
        setAwaitingMoreQuestion(false);
        resetTranscript();
        setUserInput("");
        return;
      }
      
      // Process the speech as a question
      if (debouncedSpeech.trim().length > 2) { // Minimum length check
        setUserInput(debouncedSpeech.trim());
        handleSend(debouncedSpeech.trim());
        resetTranscript();
      }
    }
  }, [debouncedSpeech, listening, awaitingMoreQuestion]);

  // Update input with transcript
  useEffect(() => {
    if (listening && transcript) {
      setUserInput(transcript);
    }
  }, [transcript, listening]);

  // IMPROVED: Speech timeout handling
  useEffect(() => {
    if (listening) {
      if (speechTimeout) clearTimeout(speechTimeout);
      
      const timeout = setTimeout(() => {
        if (transcript.trim()) {
          // If there's content, process it
          handleSend(transcript.trim());
        }
        SpeechRecognition.stopListening();
        showToast("Voice input stopped");
      }, 5000); // 5 seconds of silence
      
      setSpeechTimeout(timeout);
    } else {
      if (speechTimeout) {
        clearTimeout(speechTimeout);
        setSpeechTimeout(null);
      }
    }
    
    return () => {
      if (speechTimeout) clearTimeout(speechTimeout);
    };
  }, [transcript, listening]);

  // File upload handlers
  const handleUploadFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx,.xls,.txt,.json";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) showToast(`Uploaded file: ${file.name}`);
    };
    input.click();
    setShowOptionsDropdown(false);
  };

  const handleUploadPhoto = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) showToast(`Uploaded photo: ${file.name}`);
    };
    input.click();
    setShowOptionsDropdown(false);
  };

  // Share handlers
  const handleShareChart = async (index: number) => {
    const chartInstance = chartJsInstances.current.get(index);
    if (chartInstance) {
      const canvas = chartInstance.canvas;
      const dataUrl = canvas.toDataURL("image/png");
      if (navigator.share) {
        await navigator.share({
          title: `Chart ${index + 1}`,
          text: "Check out this chart!",
          files: [await fetch(dataUrl).then(r => r.blob()).then(blob => new File([blob], `chart_${index + 1}.png`, { type: "image/png" }))]
        });
      } else {
        await navigator.clipboard.writeText(dataUrl);
        showToast("Chart image copied to clipboard!");
      }
    }
  };

  const handleShareMap = async (index: number) => {
    const mapInstance = leafletMapRefs.current.get(index);
    if (!mapInstance) {
      showToast("Map not found for sharing.");
      return;
    }
    leafletImage(mapInstance, async function (err, canvas) {
      if (err) {
        showToast("Failed to capture map image.");
        return;
      }
      const imgData = canvas.toDataURL("image/png");
      if (navigator.share) {
        await navigator.share({
          title: `Map ${index + 1}`,
          text: "Check out this map!",
          files: [await fetch(imgData).then(r => r.blob()).then(blob => new File([blob], `map_${index + 1}.png`, { type: "image/png" }))]
        });
      } else {
        await navigator.clipboard.writeText(imgData);
        showToast("Map image copied to clipboard!");
      }
    });
  };

  const formatTimestampForDisplay = (timestamp: string, type: string) => {
    const d = new Date(timestamp);
    if (isNaN(d.getTime()))
      return type === "timeOnly" ? "Invalid Time" : "Invalid Date";

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (d1: Date, d2: Date) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    const formattedTime = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    let formattedDate;
    if (isSameDay(d, today)) formattedDate = "Today";
    else if (isSameDay(d, yesterday)) formattedDate = "Yesterday";
    else
      formattedDate = d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

    if (type === "timeOnly") return formattedTime;
    if (type === "dateOnly") return formattedDate;
    return `${formattedDate}, ${formattedTime}`;
  };

  const fetchReportData = async (question: string, retryCount = 0) => {
    setLoading(true);
    try {
      const response = await fetch("http://localhost:8090/api/chart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userMessage: question }),
      });
      const result = await response.json();
      setLoading(false);
      const replyTimestamp = new Date().toISOString();

      if (
        result &&
        typeof result.data === "string" &&
        result.data.includes("Gemini Error: Failed to execute HTTP request.") &&
        retryCount < 3
      ) {
        setTimeout(() => fetchReportData(question, retryCount + 1), 1000);
        return;
      }

      if (result.type === "ERROR") {
        updateChartList({
          type: "text",
          data: "Please ask question again.",
          timestamp: replyTimestamp,
        });
        await playElevenLabsTTS("Please ask question again.");
        return;
      }

      if (result.type === "GENERAL_RESPONSE") {
        let displayData = result.response || result.data || "No response";
        if (typeof displayData === "string") {
          try {
            const parsedContent = JSON.parse(displayData);
            displayData =
              typeof parsedContent === "string"
                ? parsedContent
                : JSON.stringify(parsedContent, null, 2);
          } catch (err) {
            console.error("Failed to parse displayData as JSON", err);
          }
        }
        updateChartList({
          type: "text",
          data: displayData,
          timestamp: replyTimestamp,
        });
        if (displayData && typeof displayData === "string") {
          await playElevenLabsTTS(displayData);
          setAwaitingMoreQuestion(true);
          await playElevenLabsTTS("Do you have any other questions?");
        }
      } else if (result.type.startsWith("CHART")) {
        if (result.type === "CHART_MAP") setCurrentMapDisplayMode("india");
        const parsedData =
          typeof result.data === "string" ? JSON.parse(result.data) : result.data;
        updateChartList({
          type: result.type,
          data: parsedData,
          timestamp: replyTimestamp,
        });
        setAwaitingMoreQuestion(true);
        await playElevenLabsTTS("Here is your chart. Do you have any other questions?");
      }
    } catch (err) {
      setLoading(false);
      updateChartList({
        type: "error",
        data: "❌ Server busy or network error. Please try again.",
        timestamp: new Date().toISOString(),
      });
      await playElevenLabsTTS("Server busy or network error. Please try again.");
    }
  };

  const updateChartList = (newItem: ChartDataItem) => {
    setChartDataList((prev) => {
      const updated = [...prev, newItem].slice(-20);
      localStorage.setItem("chartDataList", JSON.stringify(updated));
      return updated;
    });
  };

  const handleSend = (inputText?: string) => {
    const textToSend = inputText !== undefined ? inputText : userInput;
    if (textToSend.trim()) {
      const timestamp = new Date().toISOString();
      const newUserMessage: ChartDataItem = { type: "user", data: textToSend.trim(), timestamp };
      updateChartList(newUserMessage);
      fetchReportData(textToSend.trim());
      setUserInput("");
      resetTranscript();
    }
  };

  const handleClearChat = () => {
    setChartDataList([]);
    localStorage.removeItem("chartDataList");
    leafletMapRefs.current.forEach((map) => map.remove());
    leafletMapRefs.current.clear();
    leafletMarkersRefs.current.clear();
    chartJsInstances.current.forEach((chart) => chart.destroy());
    chartJsInstances.current.clear();
    setCurrentMapDisplayMode("india");
    setShowOptionsDropdown(false);
  };

  const renderLeafletMarkers = (map: L.Map, warehouseData: any[], mapIndex: number) => {
    const currentMarkers = leafletMarkersRefs.current.get(mapIndex) || [];
    currentMarkers.forEach((m) => map.removeLayer(m));
    const newMarkers: L.CircleMarker[] = [];
    const validLatLngs: L.LatLng[] = [];
    const filtered = warehouseData.filter((d) => {
      const lat = d.value?.latitude;
      const lng = d.value?.longitude;
      return typeof lat === "number" && typeof lng === "number" && isFinite(lat) && isFinite(lng);
    });
    filtered.forEach((w) => {
      const latLng = L.latLng(w.value.latitude, w.value.longitude);
      const marker = L.circleMarker(latLng, {
        radius: 8,
        fillColor: "red",
        color: "white",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9,
      }).addTo(map);
      marker.bindPopup(`<div><strong>${w.label}</strong><br>Lat: ${w.value.latitude.toFixed(2)}, Lng: ${w.value.longitude.toFixed(2)}</div>`);
      marker.on("mouseover", () => marker.openPopup());
      marker.on("mouseout", () => marker.closePopup());
      newMarkers.push(marker);
      validLatLngs.push(latLng);
    });
    leafletMarkersRefs.current.set(mapIndex, newMarkers);
    return validLatLngs;
  };

  const handleToggleMapMode = (mapIndex: number, warehouseData: any[]) => {
    const map = leafletMapRefs.current.get(mapIndex);
    if (!map) return;
    const newMode = currentMapDisplayMode === "world" ? "india" : "world";
    setCurrentMapDisplayMode(newMode);
    const latLngs = renderLeafletMarkers(map, warehouseData, mapIndex);
    if (newMode === "india") map.setView([20.5937, 78.9629], 5);
    else if (latLngs.length > 0) map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
    else map.setView([0, 0], 2);
    map.invalidateSize();
  };

  const renderChartJsChart = (canvasElement: HTMLCanvasElement, data: any[], chartType: string, index: number, timestamp: string) => {
    if (chartJsInstances.current.has(index)) {
      chartJsInstances.current.get(index)?.destroy();
      chartJsInstances.current.delete(index);
    }
    const formattedDateForChartTitle = formatTimestampForDisplay(timestamp, "dateOnly");
    const colorPalette = [
      "#3b82f6", "#f97316", "#14b8a6", "#ef4444", "#8b5cf6", "#eab308", "#6b7280",
    ];
    const borderPalette = [
      "#2563eb", "#c2410c", "#0d9488", "#dc2626", "#7c3aed", "#d97706", "#4b5563",
    ];
    const fixedBarThickness = 40;
    const fixedPointRadius = 4;

    let chartConfig: Chart.ChartConfiguration = {
      type: chartType as any,
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { position: "bottom", display: chartType !== "pie" && chartType !== "doughnut" },
          title: {
            display: true,
            text: `${chartType.toUpperCase()} Chart (${formattedDateForChartTitle})`,
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.dataset.label || "";
                let value = ctx.parsed?.y ?? ctx.parsed ?? "";
                return label ? `${label}: ${value}` : `${value}`;
              },
            },
          },
        },
        scales: {
          x: { stacked: false, display: chartType !== "pie" && chartType !== "doughnut" },
          y: { stacked: false, beginAtZero: true, display: chartType !== "pie" && chartType !== "doughnut" },
        },
      },
    };

    // Special handling for pie and doughnut charts - NO LABELS ON CHART
    if (chartType === "pie" || chartType === "doughnut") {
      chartConfig.options.plugins = {
        ...chartConfig.options.plugins,
        legend: { display: false }, // Hide legend on chart
        datalabels: { display: false }, // Hide data labels on chart
      };
      chartConfig.options!.scales!.x!.display = false;
      chartConfig.options!.scales!.y!.display = false;
    }

    const ctx = canvasElement.getContext("2d");
    if (!ctx) return;

    const isStackedData = data.length > 0 && "stack" in data[0];

    if ((chartType === "bar" || chartType === "line") && isStackedData) {
      const labels = Array.from(new Set(data.map((d) => d.label)));
      const stacks = Array.from(new Set(data.map((d) => d.stack)));
      const datasets = stacks.map((stackName, idx) => ({
        label: stackName,
        data: labels.map((label) => {
          const item = data.find((d) => d.label === label && d.stack === stackName);
          return item ? item.value : 0;
        }),
        backgroundColor: colorPalette[idx % colorPalette.length],
        borderColor: borderPalette[idx % borderPalette.length],
        borderWidth: 1,
        ...(chartType === "bar"
          ? {
            barThickness: fixedBarThickness,
            maxBarThickness: fixedBarThickness,
            barPercentage: 0.7,
            categoryPercentage: 0.8,
          }
          : {
            fill: false,
            pointRadius: fixedPointRadius,
            borderWidth: 2,
            tension: 0.3,
          }),
      }));
      chartConfig.data = { labels, datasets };
      chartConfig.options.scales!.x!.stacked = true;
      chartConfig.options.scales!.y!.stacked = true;
    } else if (chartType === "bar") {
      const labelKey = data[0]?.name ? "name" : "label";
      const labels = data.map((d) => d[labelKey]);
      const numericKeys = Object.keys(data[0]).filter(
        (k) => k !== labelKey && typeof data[0][k] === "number"
      );
      const datasets = numericKeys.map((key, idx) => ({
        label: key,
        data: labels.map((l) => {
          const item = data.find((d) => d[labelKey] === l);
          return item ? item[key] || 0 : 0;
        }),
        backgroundColor: colorPalette[idx % colorPalette.length],
        borderColor: borderPalette[idx % borderPalette.length],
        borderWidth: 1,
        barThickness: fixedBarThickness,
        maxBarThickness: fixedBarThickness,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      }));
      chartConfig.data = { labels, datasets };
    } else if (chartType === "line") {
      const labels = data.map((d) => d.label || d.name || "");
      const values = data.map((d) => d.value || 0);
      chartConfig.data = {
        labels,
        datasets: [
          {
            label: "Values",
            data: values,
            borderColor: borderPalette[0],
            backgroundColor: colorPalette[0] + "88",
            fill: false,
            pointRadius: fixedPointRadius,
            borderWidth: 2,
            tension: 0.3,
          },
        ],
      };
    } else {
      const labels = data.map((d) => d.label || d.name || "");
      const values = data.map((d) => d.value || 0);
      chartConfig.data = {
        labels,
        datasets: [
          {
            label: "Values",
            data: values,
            backgroundColor: colorPalette,
            borderColor: borderPalette,
            borderWidth: 1,
          },
        ],
      };
    }

    const newChart = new Chart(ctx, chartConfig);
    chartJsInstances.current.set(index, newChart);
  };

  const handleDownloadChart = (index: number) => {
    if (chartJsInstances.current.has(index)) {
      const chartInstance = chartJsInstances.current.get(index);
      if (chartInstance) {
        const canvas = chartInstance.canvas;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `chart_${index + 1}_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
    setShowOptionsDropdown(false);
  };

  const handleDownloadMap = (index: number) => {
    const mapInstance = leafletMapRefs.current.get(index);
    if (!mapInstance) {
      showToast("Map not found for download.");
      return;
    }
    leafletImage(mapInstance, function (err, canvas) {
      if (err) {
        showToast("Failed to capture map image.");
        return;
      }
      const imgData = canvas.toDataURL("image/jpeg", 0.9);
      const link = document.createElement("a");
      link.href = imgData;
      link.download = `map_${index + 1}_${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
    setShowOptionsDropdown(false);
  };

  const handleDownloadFullChatPDF = async () => {
    if (!chatContainerRef.current) {
      showToast("Cannot find chat container!");
      return;
    }
    const pdf = new jsPDF('p', 'mm', 'a4');
    const chats = chartDataList;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let yOffset = 10;

    for (let i = 0; i < chats.length; i++) {
      const item = chats[i];

      if (item.type === 'user') {
        const text = item.data;
        const lines = pdf.splitTextToSize(text, pageWidth / 2 - 20);
        const boxWidth = pageWidth / 2 - 10;
        const boxHeight = lines.length * 8 + 14;
        if (yOffset + boxHeight > pageHeight - 20) {
          pdf.addPage();
          yOffset = 10;
        }
        pdf.setFillColor(37, 99, 235);
        pdf.roundedRect(pageWidth - boxWidth - 10, yOffset, boxWidth, boxHeight, 4, 4, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(12);
        pdf.text('You:', pageWidth - boxWidth, yOffset + 8);
        pdf.setFontSize(11);
        pdf.text(lines, pageWidth - boxWidth, yOffset + 18);
        pdf.setTextColor(0, 0, 0);
        yOffset += boxHeight + 6;
      } else if (item.type === 'text') {
        const text = item.data;
        const lines = pdf.splitTextToSize(text, pageWidth / 2 - 20);
        const boxWidth = pageWidth / 2 - 10;
        const boxHeight = lines.length * 8 + 14;
        if (yOffset + boxHeight > pageHeight - 20) {
          pdf.addPage();
          yOffset = 10;
        }
        pdf.setFillColor(243, 244, 246);
        pdf.roundedRect(10, yOffset, boxWidth, boxHeight, 4, 4, 'F');
        pdf.setTextColor(55, 65, 81);
        pdf.setFontSize(12);
        pdf.text('Bot:', 14, yOffset + 8);
        pdf.setFontSize(11);
        pdf.text(lines, 14, yOffset + 18);
        pdf.setTextColor(0, 0, 0);
        yOffset += boxHeight + 6;
      } else if (item.type === 'error') {
        const text = item.data;
        const lines = pdf.splitTextToSize(text, pageWidth / 2 - 20);
        const boxWidth = pageWidth / 2 - 10;
        const boxHeight = lines.length * 8 + 14;
        if (yOffset + boxHeight > pageHeight - 20) {
          pdf.addPage();
          yOffset = 10;
        }
        pdf.setFillColor(254, 202, 202);
        pdf.roundedRect(10, yOffset, boxWidth, boxHeight, 4, 4, 'F');
        pdf.setTextColor(220, 38, 38);
        pdf.setFontSize(12);
        pdf.text('Error:', 14, yOffset + 8);
        pdf.setFontSize(11);
        pdf.text(lines, 14, yOffset + 18);
        pdf.setTextColor(0, 0, 0);
        yOffset += boxHeight + 6;
      } else if (item.type === 'CHART_MAP') {
        const mapInstance = leafletMapRefs.current.get(i);
        if (!mapInstance) continue;
        try {
          const imgData = await new Promise<string>((resolve, reject) => {
            leafletImage(mapInstance, (err, canvas) => {
              if (err) reject(err);
              else resolve(canvas.toDataURL('image/jpeg', 0.9));
            });
          });
          const imgProps = pdf.getImageProperties(imgData);
          const pdfWidth = pageWidth - 20;
          const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
          if (yOffset + pdfHeight > pageHeight - 20) {
            pdf.addPage();
            yOffset = 10;
          }
          pdf.setFontSize(13);
          pdf.setTextColor(37, 99, 235);
          pdf.text("Map Chart", 12, yOffset + 8);
          pdf.setTextColor(0, 0, 0);
          yOffset += 12;
          pdf.roundedRect(10, yOffset, pdfWidth, pdfHeight, 6, 6);
          pdf.addImage(imgData, 'JPEG', 10, yOffset, pdfWidth, pdfHeight);
          yOffset += pdfHeight + 10;
        } catch {
          if (yOffset + 15 > pageHeight - 20) {
            pdf.addPage();
            yOffset = 10;
          }
          pdf.text("[Map Image Failed to Capture]", 10, yOffset);
          yOffset += 15;
        }
      } else if (item.type.startsWith('CHART')) {
        const elementId = `chart-canvas-${i}`;
        const element = document.getElementById(elementId);
        if (!element) continue;
        try {
          const canvasImage = await html2canvas(element, { scale: 2 });
          const imgData = canvasImage.toDataURL('image/jpeg', 0.9);
          const imgProps = pdf.getImageProperties(imgData);
          const pdfWidth = pageWidth - 20;
          const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
          if (yOffset + pdfHeight > pageHeight - 20) {
            pdf.addPage();
            yOffset = 10;
          }
          pdf.setFontSize(13);
          pdf.setTextColor(37, 99, 235);
          pdf.text("Chart", 12, yOffset + 8);
          pdf.setTextColor(0, 0, 0);
          yOffset += 12;
          pdf.roundedRect(10, yOffset, pdfWidth, pdfHeight, 6, 6);
          pdf.addImage(imgData, 'JPEG', 10, yOffset, pdfWidth, pdfHeight);
          yOffset += pdfHeight + 10;
        } catch {
          if (yOffset + 15 > pageHeight - 20) {
            pdf.addPage();
            yOffset = 10;
          }
          pdf.text("[Chart Image Failed to Capture]", 10, yOffset);
          yOffset += 15;
        }
      }
    }

    pdf.save(`Chat_Report_${new Date().toISOString()}.pdf`);
    setShowOptionsDropdown(false);
  };

  useEffect(() => {
    chartDataList.forEach((item, index) => {
      if (item.type === "CHART_MAP") {
        const mapContainerId = `map-container-${index}`;
        const mapContainerElement = document.getElementById(mapContainerId);
        if (mapContainerElement) {
          let mapInstance = leafletMapRefs.current.get(index);
          if (!mapInstance) {
            mapInstance = L.map(mapContainerElement, { zoomControl: true, attributionControl: false });
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
              attribution:
                "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
            }).addTo(mapInstance);
            leafletMapRefs.current.set(index, mapInstance);
          }
          mapInstance.invalidateSize();
          const latLngs = renderLeafletMarkers(mapInstance, item.data, index);
          if (currentMapDisplayMode === "india") mapInstance.setView([20.5937, 78.9629], 5);
          else if (latLngs.length > 0) mapInstance.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
          else mapInstance.setView([0, 0], 2);
        }
      } else if (item.type.startsWith("CHART_")) {
        const rawType = item.type.replace("CHART_", "").toLowerCase();
        const chartType =
          ["stackedbar"].includes(rawType)
            ? "bar"
            : ["stackedline"].includes(rawType)
              ? "line"
              : rawType;
        const canvasId = `chart-canvas-${index}`;
        const canvasElement = document.getElementById(canvasId) as HTMLCanvasElement | null;
        if (canvasElement)
          renderChartJsChart(canvasElement, item.data, chartType, index, item.timestamp);
      }
    });

    const currentIndices = new Set(chartDataList.map((_, i) => i));
    chartJsInstances.current.forEach((chart, index) => {
      if (!currentIndices.has(index)) {
        chart.destroy();
        chartJsInstances.current.delete(index);
      }
    });
    leafletMapRefs.current.forEach((map, index) => {
      if (!currentIndices.has(index)) {
        map.remove();
        leafletMapRefs.current.delete(index);
        leafletMarkersRefs.current.delete(index);
      }
    });

    return () => {
      chartJsInstances.current.forEach((chart) => chart.destroy());
      chartJsInstances.current.clear();
      leafletMapRefs.current.forEach((map) => map.remove());
      leafletMapRefs.current.clear();
      leafletMarkersRefs.current.clear();
    };
  }, [chartDataList, currentMapDisplayMode]);

  useEffect(() => {
    if (chatMessagesEndRef.current)
      chatMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chartDataList]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        optionsDropdownRef.current &&
        !optionsDropdownRef.current.contains(event.target as Node)
      ) {
        setShowOptionsDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  let lastDisplayedDate: string | null = null;

  return (
    <div className="relative flex flex-col min-h-screen bg-white dark:bg-gray-900 text-black dark:text-white font-inter">
      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto pb-28">
        <div className="w-full max-w-5xl mx-auto space-y-4" ref={chatContainerRef}>
          {chartDataList.map((item, index) => {
            const currentDate = formatTimestampForDisplay(item.timestamp, "dateOnly");
            const showDateHeader = lastDisplayedDate !== currentDate;
            const isEmptyData =
              item.data == null ||
              (Array.isArray(item.data) && item.data.length === 0) ||
              (typeof item.data === "object" && !Array.isArray(item.data) && Object.keys(item.data).length === 0);

            if (item.type === "text" && isEmptyData) {
              return (
                <React.Fragment key={index}>
                  {showDateHeader && (
                    <div className="w-full flex justify-center my-3">
                      <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                        {currentDate}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-start w-full">
                    <div className="flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-black dark:text-white relative mr-auto">
                      <div className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">
                        Bot🤖
                      </div>
                      <div className="pb-4 break-words">Please ask question again.</div>
                      <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            if (item.type.startsWith("CHART_") && isEmptyData) {
              return (
                <React.Fragment key={index}>
                  {showDateHeader && (
                    <div className="w-full flex justify-center my-3">
                      <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                        {currentDate}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-start w-full">
                    <div className="flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-black dark:text-white relative mr-auto">
                      <div className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">
                        Bot🤖
                      </div>
                      <div className="pb-4 break-words">No chart/map data available.</div>
                      <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            }

            if (showDateHeader) lastDisplayedDate = currentDate;

            let messageContent = null;
            let messageCardClass = "";
            const alignment = item.type === "user" ? "justify-end" : "justify-start";
            const formattedTime = formatTimestampForDisplay(item.timestamp, "timeOnly");

            if (item.type === "user") {
              messageCardClass =
                "flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-blue-600 text-white relative";
              messageContent = (
                <>
                  <div className="font-semibold text-xs mb-1">You</div>
                  <div className="pb-4 break-words">{item.data}</div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-blue-200 whitespace-nowrap">
                    {formattedTime}
                  </div>
                </>
              );
            } else if (item.type === "text") {
              messageCardClass =
                "flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-black dark:text-white relative mr-auto";
              messageContent = (
                <>
                  <div className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">
                    Bot🤖
                  </div>
                  <div className="pb-4 break-words">
                    <pre className="whitespace-pre-wrap">{item.data}</pre>
                  </div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formattedTime}
                  </div>
                </>
              );
            } else if (item.type === "error") {
              messageCardClass =
                "flex flex-col max-w-sm px-4 py-2 rounded-xl shadow text-sm flex-shrink-0 bg-red-100 text-red-700 relative mr-auto";
              messageContent = (
                <>
                  <div className="pb-4 break-words">{item.data}</div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formattedTime}
                  </div>
                </>
              );
            } else if (item.type === "CHART_MAP") {
              messageCardClass =
                "relative w-full h-[calc(100vh-250px)] min-h-[400px] bg-white dark:bg-gray-700 rounded-xl shadow p-2 flex flex-col";
              messageContent = (
                <>
                  <div
                    id={`map-container-${index}`}
                    style={{ width: "100%", height: "100%" }}
                    className="overflow-hidden rounded-lg"
                  />
                  <div className="map-overlay-controls">
                    <Button
                      onClick={() => handleToggleMapMode(index, item.data)}
                      className="bg-blue-600 text-white hover:bg-blue-700 rounded-full p-2 text-xs flex items-center gap-1 shadow-md"
                      title={
                        currentMapDisplayMode === "world"
                          ? "Zoom In to India"
                          : "Zoom Out to World"
                      }
                    >
                      {currentMapDisplayMode === "world" ? (
                        <MapPin className="w-3 h-3" />
                      ) : (
                        <Globe className="w-3 h-3" />
                      )}
                      {currentMapDisplayMode === "world"
                        ? "Zoom In to India"
                        : "Zoom Out to World"}
                    </Button>
                    <Button
                      onClick={() => handleDownloadMap(index)}
                      className="bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                      title={`Download Map ${index + 1}`}
                      aria-label={`Download Map ${index + 1}`}
                    >
                      <Download className="w-5 h-5" />
                    </Button>
                    <Button
                      onClick={() => handleShareMap(index)}
                      className="bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                      title={`Share Map ${index + 1}`}
                      aria-label={`Share Map ${index + 1}`}
                    >
                      <Share2 className="w-5 h-5" />
                    </Button>
                  </div>
                  <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                  </div>
                  <style>{`
                    #map-container-${index} {
                      position: relative;
                      padding-top: 40px;
                      height: 100%;
                      width: 100%;
                    }
                    .map-overlay-controls {
                      position: absolute;
                      top: 8px;
                      right: 8px;
                      z-index: 1200;
                      display: flex;
                      gap: 8px;
                    }
                    .leaflet-control {
                      z-index: 1100 !important;
                    }
                  `}</style>
                </>
              );
            } else if (item.type.startsWith("CHART_")) {
              const rawType = item.type.replace("CHART_", "").toLowerCase();
              const isPieChart = rawType === "pie" || rawType === "doughnut";

              if (isPieChart) {
                // Special handling for pie charts - separate cards
                return (
                  <React.Fragment key={index}>
                    {showDateHeader && (
                      <div className="w-full flex justify-center my-3">
                        <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                          {currentDate}
                        </div>
                      </div>
                    )}
                    
                    {/* Chart Type Info Card */}
                    <div className="w-full bg-blue-50 dark:bg-blue-900 rounded-lg border border-blue-200 dark:border-blue-700 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                            <span className="text-white text-sm font-bold">📊</span>
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-200">
                              {rawType.charAt(0).toUpperCase() + rawType.slice(1)} Chart
                            </h3>
                            <p className="text-sm text-blue-600 dark:text-blue-300">
                              Data visualization created on {formatTimestampForDisplay(item.timestamp, "dateOnly")}
                            </p>
                          </div>
                        </div>
                        <div className="text-sm text-blue-500 dark:text-blue-400">
                          {item.data.length} data points
                        </div>
                      </div>
                    </div>

                    {/* Pie Chart Card */}
                    <div className="w-full bg-white dark:bg-gray-700 rounded-lg border p-4 flex flex-col relative">
                      <div className="h-[400px] w-full flex items-center justify-center">
                        <canvas
                          id={`chart-canvas-${index}`}
                          className="max-h-full max-w-full"
                          style={{ height: "400px", width: "400px" }}
                        />
                      </div>
                      <div className="absolute top-2 right-2 flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => handleDownloadChart(index)}
                          className="bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                          title={`Download Chart ${index + 1}`}
                          aria-label={`Download Chart ${index + 1}`}
                        >
                          <Download className="w-5 h-5" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleShareChart(index)}
                          className="bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                          title={`Share Chart ${index + 1}`}
                          aria-label={`Share Chart ${index + 1}`}
                        >
                          <Share2 className="w-5 h-5" />
                        </Button>
                      </div>
                      <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatTimestampForDisplay(item.timestamp, "timeOnly")}
                      </div>
                    </div>

                    {/* Legend Card */}
                    <PieChartLegend data={item.data} timestamp={item.timestamp} />
                  </React.Fragment>
                );
              }

              // Handle other chart types (bar, line, etc.)
              const baseChartType =
                ["stackedbar"].includes(rawType)
                  ? "bar"
                  : ["stackedline"].includes(rawType)
                    ? "line"
                    : rawType;

              if (["bar", "line"].includes(baseChartType)) {
                return (
                  <React.Fragment key={index}>
                    {showDateHeader && (
                      <div className="w-full flex justify-center my-3">
                        <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                          {currentDate}
                        </div>
                      </div>
                    )}
                    <ChartContainer dataLength={item.data.length} className="relative">
                      <canvas
                        id={`chart-canvas-${index}`}
                        className="h-full w-full"
                        style={{ height: "500px" }}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => handleDownloadChart(index)}
                        className="absolute top-2 right-2 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                        title={`Download Chart ${index + 1}`}
                        aria-label={`Download Chart ${index + 1}`}
                      >
                        <Download className="w-5 h-5" />
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleShareChart(index)}
                        className="absolute top-2 right-12 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                        title={`Share Chart ${index + 1}`}
                        aria-label={`Share Chart ${index + 1}`}
                      >
                        <Share2 className="w-5 h-5" />
                      </Button>
                      <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap z-10">
                        {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                      </div>
                    </ChartContainer>
                  </React.Fragment>
                );
              }

              // Fallback for other chart types
              messageCardClass = "w-full h-[400px] bg-white dark:bg-gray-700 rounded-lg border p-2 flex flex-col relative overflow-hidden";
              messageContent = (
                <>
                  <canvas
                    id={`chart-canvas-${index}`}
                    className="h-full w-full"
                    style={{ height: "400px" }}
                  />
                  <div className="absolute bottom-1 right-12 text-[10px] text-gray-500 dark:text-gray-400 z-10 whitespace-nowrap">
                    {formatTimestampForDisplay(item.timestamp, "fullDateTime")}
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => handleDownloadChart(index)}
                    className="absolute top-2 right-2 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                    title={`Download Chart ${index + 1}`}
                    aria-label={`Download Chart ${index + 1}`}
                  >
                    <Download className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleShareChart(index)}
                    className="absolute top-2 right-12 bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800 rounded-full p-1 shadow-md"
                    title={`Share Chart ${index + 1}`}
                    aria-label={`Share Chart ${index + 1}`}
                  >
                    <Share2 className="w-5 h-5" />
                  </Button>
                </>
              );
            }

            return (
              <React.Fragment key={index}>
                {showDateHeader && (
                  <div className="w-full flex justify-center my-3">
                    <div className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                      {currentDate}
                    </div>
                  </div>
                )}
                <div className={`flex ${alignment} w-full`}>
                  <div className={messageCardClass}>{messageContent}</div>
                </div>
              </React.Fragment>
            );
          })}
          <div ref={chatMessagesEndRef} />
        </div>
      </div>

      <div className="fixed bottom-0 right-0 left-[224px] bg-white dark:bg-gray-900 py-3 px-4 z-20 shadow-lg">
        <div
          className={`mx-auto max-w-5xl flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-2 shadow-md transition-colors border ${inputFocused ? "border-blue-600" : "border-transparent"
            }`}
          style={{ gap: "8px" }}
          onClick={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          tabIndex={-1}
        >
          <button
            onClick={handleVoiceButtonClick}
            aria-pressed={listening}
            aria-label={listening ? "Stop Voice Input" : "Start Voice Input"}
            className={`relative rounded-full w-11 h-11 flex items-center justify-center transition-colors focus:outline-none focus:ring-4 focus:ring-blue-500 ${listening ? "bg-blue-700 text-white ring-4 ring-blue-300 animate-pulse" : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
              className="w-7 h-7"
            >
              <path d="M12 14C13.654 14 15 12.654 15 11V5C15 3.346 13.654 2 12 2C10.346 2 9 3.346 9 5V11C9 12.654 10.346 14 12 14Z" />
              <path d="M19 11C19 14.3137 16.3137 17 13 17H11C7.68629 17 5 14.3137 5 11H7C7 13.2091 8.79086 15 11 15H13C15.2091 15 17 13.2091 17 11H19Z" />
              <rect x="11" y="18" width="2" height="4" rx="1" />
            </svg>
          </button>

          <input
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-base px-4 py-3 text-black dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            placeholder="What would you like to analyze?"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            aria-label="Ask a report question"
          />

          <div className="relative" ref={optionsDropdownRef}>
            <Button
              variant="ghost"
              onClick={() => setShowOptionsDropdown(!showOptionsDropdown)}
              className="p-3 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              title="More options"
              aria-haspopup="true"
              aria-expanded={showOptionsDropdown}
            >
              <MoreVertical className="w-6 h-6" />
            </Button>
            {showOptionsDropdown && (
              <div
                style={{ position: "absolute", right: 0, bottom: "100%", marginBottom: "0.5rem", zIndex: 40, width: "11rem" }}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 animate-fade-in-up"
              >
                <button
                  onClick={() => {
                    if (chartDataList.length === 0) showToast("No chat to download.");
                    else handleDownloadFullChatPDF();
                    setShowOptionsDropdown(false);
                  }}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" /> Download Full Chat PDF
                </button>
                <button
                  onClick={handleUploadFile}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                >
                  <Paperclip className="w-4 h-4" /> Upload File
                </button>
                <button
                  onClick={handleUploadPhoto}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
                >
                  <ImageIcon className="w-4 h-4" /> Upload Photo
                </button>
                <button
                  onClick={handleClearChat}
                  className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-100 dark:hover:bg-red-700 dark:text-red-400 whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4" /> Clear Chat History
                </button>
              </div>
            )}
          </div>

          <Button
            onClick={() => handleSend()}
            className="rounded-full p-3 bg-blue-600 text-white hover:bg-blue-700 shadow-md"
            disabled={loading || !userInput.trim()}
            title="Send question"
            aria-label="Send question"
          >
            <SendHorizonal className="w-5 h-5" />
          </Button>
        </div>
        {loading && (
          <div className="absolute -top-6 left-0 right-0 text-sm text-blue-600 animate-pulse text-center">
            Loading...
          </div>
        )}
        {listening && (
          <div className="absolute -top-12 left-0 right-0 text-sm text-blue-600 animate-pulse text-center bg-blue-50 dark:bg-blue-900 py-1 rounded-md">
            🎤 Listening... Speak now!
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportDashboard;