import com.eteks.sweethome3d.io.HomeFileRecorder;
import com.eteks.sweethome3d.model.Content;
import com.eteks.sweethome3d.model.Home;
import com.eteks.sweethome3d.model.HomePieceOfFurniture;
import com.eteks.sweethome3d.model.HomeTexture;
import com.eteks.sweethome3d.model.Room;
import com.eteks.sweethome3d.model.Wall;
import java.io.InputStream;

/**
 * Kompatibilitaetstest: liest .sh3d-Dateien mit dem Original-Leser von
 * Sweet Home 3D und gibt eine Zusammenfassung aus. Jede Ressource (Modell,
 * Icon, Textur) wird geoeffnet und vollstaendig gelesen.
 *
 * Aufruf: java -cp "SweetHome3D.jar;." ReadHome datei1.sh3d [datei2.sh3d ...]
 * Exit-Code 0 = alle Dateien lesbar, 1 = mindestens ein Fehler.
 */
public class ReadHome {
  public static void main(String[] args) {
    boolean ok = true;
    for (String file : args) {
      // Gleiche Konfiguration wie die App selbst (com.eteks.sweethome3d.SweetHome3D):
      // HomeFileRecorder(0, false, preferences, false, preferXmlEntry=true, true).
      // Mit preferXmlEntry=false liest SH3D nur den Java-serialisierten "Home"-Eintrag,
      // den My Sweet Home nicht schreibt.
      for (boolean preferXml : new boolean[] {true}) {
        try {
          Home home = new HomeFileRecorder(0, false, null, false, preferXml, true).readHome(file);
          int pieces = 0;
          long bytes = 0;
          for (HomePieceOfFurniture p : home.getFurniture()) {
            for (HomePieceOfFurniture q : expand(p)) {
              pieces++;
              bytes += readAll(q.getModel()) + readAll(q.getIcon());
              if (q.getTexture() != null) {
                bytes += readAll(q.getTexture().getImage());
              }
            }
          }
          for (Wall w : home.getWalls()) {
            bytes += texture(w.getLeftSideTexture()) + texture(w.getRightSideTexture());
          }
          for (Room r : home.getRooms()) {
            bytes += texture(r.getFloorTexture()) + texture(r.getCeilingTexture());
          }
          System.out.println("OK   " + file + " (preferXmlEntry=" + preferXml + ")"
              + " version=" + home.getVersion()
              + " levels=" + home.getLevels().size()
              + " walls=" + home.getWalls().size()
              + " rooms=" + home.getRooms().size()
              + " pieces=" + pieces
              + " dimensionLines=" + home.getDimensionLines().size()
              + " labels=" + home.getLabels().size()
              + " polylines=" + home.getPolylines().size()
              + " contentBytes=" + bytes);
        } catch (com.eteks.sweethome3d.model.DamagedHomeRecorderException e) {
          // XML gelesen, aber Ressourcen fehlen (z. B. Beispielprojekte, deren Modelle
          // im Katalog von SH3D liegen). Struktur trotzdem ausgeben.
          ok = false;
          Home home = e.getDamagedHome();
          System.out.println("MISSING " + file
              + " missingContents=" + e.getInvalidContent().size()
              + " version=" + home.getVersion()
              + " levels=" + home.getLevels().size()
              + " walls=" + home.getWalls().size()
              + " rooms=" + home.getRooms().size()
              + " pieces=" + home.getFurniture().size()
              + " dimensionLines=" + home.getDimensionLines().size()
              + " labels=" + home.getLabels().size()
              + " polylines=" + home.getPolylines().size());
        } catch (Throwable t) {
          ok = false;
          System.out.println("FAIL " + file + " (preferXmlEntry=" + preferXml + "): " + t);
          t.printStackTrace(System.out);
        }
      }
    }
    System.exit(ok ? 0 : 1);
  }

  private static java.util.List<HomePieceOfFurniture> expand(HomePieceOfFurniture p) {
    if (p instanceof com.eteks.sweethome3d.model.HomeFurnitureGroup) {
      return ((com.eteks.sweethome3d.model.HomeFurnitureGroup) p).getAllFurniture();
    }
    return java.util.Collections.singletonList(p);
  }

  private static long texture(HomeTexture t) throws Exception {
    return t == null ? 0 : readAll(t.getImage());
  }

  private static long readAll(Content c) throws Exception {
    if (c == null) {
      return 0;
    }
    long n = 0;
    try (InputStream in = c.openStream()) {
      byte[] buf = new byte[65536];
      for (int r; (r = in.read(buf)) != -1; ) {
        n += r;
      }
    }
    return n;
  }
}
