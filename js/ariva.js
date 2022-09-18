// Script for Hibiscus Depot Viewer
// Updated 18.09.2022 by @faiteanu
// Original version by @mikekorb

try {
	load("nashorn:mozilla_compat.js");
	var prejava8 = false;
	var ArrayList = Java.type('java.util.ArrayList');
	var Logger = Java.type('de.willuhn.logging.Logger');
} catch(e) {
	// Rhino
	var prejava8 = true;
	var ArrayList = java.util.ArrayList;
};
var fetcher; 
var webClient;
var url;
var kursUrl;

var y1,m1,d1,y2,m2,d2;

function getAPIVersion() {
	return "1";
};

function getVersion() {
	return "2022-09-18";
};

function getName() {
	return "Ariva";
};

function getURL() {
	return "http://www.ariva.de";
};

function prepare(fetch, search, startyear, startmon, startday, stopyear, stopmon, stopday) {
	fetcher = fetch;
	y1 = startyear; m1 = startmon; d1 = startday;
	y2 = stopyear; m2 = stopmon; d2 = stopday;

	webClient = fetcher.getWebClient(false);
	url= getURL()


	var cfgliste = new ArrayList();
	

	page = webClient.getPage(url + "/search/livesearch.m?searchname=" + search);

	var link = page.getContent().match(/<a href="([^"]+)"/);
	if (link){
		if(link[1].indexOf("secu=") > 0){
			// fonds use a different URL from shares
			kursUrl = url + "/quote/historic.m?" + link[1].substring(link[1].indexOf("secu="));		
		}else{
			url += link[1];
			kursUrl = url + "/historische_kurse";			
		}
      	print(kursUrl);
		page = webClient.getPage(kursUrl);
		extractBasisdata(page);

		//Handelsplatz
		
		options = getLinksForSelection("handelsplatz", page);
		if (options.size() > 0) {
			var cfg = new Packages.jsq.config.Config("Handelsplatz");
			for (i = 0; i < options.size(); i++) {
				cfg.addAuswahl(options.get(i), new String("handelsplatz"));
			}
			cfgliste.add(cfg);
		}

		// Währung
		options = getLinksForSelection("waehrung", page);
		if (options.size() > 0) {
			var cfg = new Packages.jsq.config.Config("Währung");
			for (i = 0; i < options.size(); i++) {
				if (options.get(i).contains("wählen")) {
					continue;
				}
				cfg.addAuswahl(options.get(i), new String("waehrung"));
			}
			cfgliste.add(cfg);
		}

	}
	return cfgliste;
};

function process(config) {
	print("Processing");
	var defaultcur = "EUR";
	var handelsplatz = "";
	var boerse_id="";
	var currency_id="";
	//var secu = "";

	for (i = 0; i < config.size(); i++) {
		var cfg = config.get(i);
		for (j = 0; j < cfg.getSelected().size(); j++) {
			var o = cfg.getSelected().get(j);
			if (o.getObj().toString().equals("waehrung")) {
				defaultcur = o.toString(); 
				var found = 0;
            
				select = getSelect(o.getObj(), page);
				optionslist = select.getOptions(); 
				for (var k = 0; k < optionslist.size(); k++) {
					var option = optionslist.get(k);
					if (option.getText().trim().equals(o.toString())) {
						print("Selecting " + option.getText());
						currency_id = option.getValueAttribute();
						option.setSelected(true);
						found = 1;
					}
				}
				if (found == 0) {
					print("Warnung: Link für " + o.getObj() + " nicht gefunden!");
				}
			} else if (o.getObj().toString().equals("handelsplatz")) {
				handelsplatz = o.toString(); 
				var found = 0;
            
				select = getSelect(o.getObj(), page);
				optionslist = select.getOptions(); 
				for (var k = 0; k < optionslist.size(); k++) {
					var option = optionslist.get(k);
					if (option.getText().trim().equals(o.toString())) {
						print("Selecting " + option.getText());
						boerse_id= option.getValueAttribute();
						option.setSelected(true);
						found = 1;
					}
				}
				if (found == 0) {
					print("Warnung: Link für " + o.getObj() + " nicht gefunden!");
				}
			}
		}
	}
	if (boerse_id){
    	var histUrl= getURL() + "/quote/historic/historic.csv?secu=" + Packages.jsq.tools.HtmlUnitTools.getFirstElementByXpath(page, "//input[@name='secu']").getValueAttribute() 
			+ "&boerse_id=" + boerse_id + "&clean_split=1&clean_payout=1&clean_bezug=1&currency=" + currency_id + "&min_time=" + d1 + "." + m1 + "." + y1 
			+"&max_time=" + d2 + "." + m2 + "." + y2 + "&trenner=%3B&go=Download";
    	print(histUrl);
		text = webClient.getPage(histUrl);
    	defaultcur = Packages.jsq.tools.CurrencyTools.correctCurrency(defaultcur);
		evalCSV(text.getContent(), defaultcur);
	}
	extractEvents(page, handelsplatz);

};


function extractEvents(page, handelsplatz) {

	var dict = {};
	dict["Gratisaktien"] = Packages.jsq.datastructes.Const.STOCKDIVIDEND;
	dict["Dividende"] = Packages.jsq.datastructes.Const.CASHDIVIDEND;
	dict["Ausschüttung"] = Packages.jsq.datastructes.Const.CASHDIVIDEND;
	dict["Split"] = Packages.jsq.datastructes.Const.STOCKSPLIT;
	dict["Reverse Split"] = Packages.jsq.datastructes.Const.STOCKREVERSESPLIT;
	dict["Bezugsrecht"] = Packages.jsq.datastructes.Const.SUBSCRIPTIONRIGHTS;


	eventUrl = url + "/dividende-split/?clean_split=0";			
	
  	print(eventUrl);
	page = webClient.getPage(eventUrl);
	tab = Packages.jsq.tools.HtmlUnitTools.getElementByPartContent(page, "Datum", "table");
	list = Packages.jsq.tools.HtmlUnitTools.analyse(tab);

	var res = new ArrayList();
	for (i = 0; i < list.size(); i++) {
		hashmap = list.get(i);
		if (hashmap.get("Ereignis") == "Euro-Umstellung") {
			continue;
		}

		// filter date range
		d = Packages.jsq.tools.VarTools.parseDate(hashmap.get("Datum"), "dd.MM.yy");
		if (!fetcher.within(d)) { 
			continue;
		}

		var dc = new Packages.jsq.datastructes.Datacontainer();
		// Teilweise unterscheiden sich die Termine nach Handelsplätzen
		if (hashmap.get("Handelsplätze") != null && hashmap.get("Handelsplätze") != "") {
			hp =  java.util.Arrays.asList(hashmap.get("Handelsplätze").split(", "))
			if (!hp.contains(handelsplatz)) {
				// Nicht unser Handelsplatz
				continue;
			}
		}
		dc.put("date", d);
		dc.put("ratio", hashmap.get("Verhältnis"));
		action = dict[hashmap.get("Ereignis")];
		if (typeof action === "undefined") {
			print("Undef für " + hashmap);
		}		
		dc.put("action", action);
		cur = null;
		amount = null;
		if (hashmap.get("Betrag") != null && hashmap.get("Betrag") != "") {
			betrag = hashmap.get("Betrag").split(" ");
			amount = Packages.jsq.tools.VarTools.stringToBigDecimalGermanFormat(betrag[0]);
			cur = betrag[1];
		}
		dc.put("value", amount);
		dc.put("currency", cur);
		res.add(dc);
	}
	fetcher.setHistEvents(res);

}



function evalCSV(content, defaultcur)  {
	var records = Packages.jsq.tools.CsvTools.getRecordsFromCsv(";", content);
	var res = new ArrayList();
	for (i = 0; i < records.size(); i++) {
		var record = records.get(i);
		var dc = new Packages.jsq.datastructes.Datacontainer();
		dc.put("date", Packages.jsq.tools.VarTools.parseDate(record.get("Datum"), "yyyy-MM-dd"));
		dc.put("first", Packages.jsq.tools.VarTools.stringToBigDecimalGermanFormat(record.get("Erster")));
		dc.put("last", Packages.jsq.tools.VarTools.stringToBigDecimalGermanFormat(record.get("Schlusskurs")));
		dc.put("low", Packages.jsq.tools.VarTools.stringToBigDecimalGermanFormat(record.get("Tief")));
		dc.put("high", Packages.jsq.tools.VarTools.stringToBigDecimalGermanFormat(record.get("Hoch")));
		dc.put("currency", defaultcur);
		res.add(dc);
	}
	print(records.size() + " Kurse geladen");
	fetcher.setHistQuotes(res);
}

function getSelect(search,  page) {
	return page.getFirstByXPath("//select[contains(@class, '"  + search + "')]");
}

function getLinksForSelection(search,  page) {
	var ret = new ArrayList();
	select = getSelect(search, page);
	if (select) {
		optionslist = select.getOptions(); 
		for (var i = 0; i < optionslist.size(); i++) {
			var div = optionslist.get(i);
			content = div.getText().trim();
			ret.add(content);
		}
	}
	return ret;
}

function extractBasisdata(page) {
	var dc = new Packages.jsq.datastructes.Datacontainer();
	
	wkn = Packages.jsq.tools.HtmlUnitTools.getElementByPartContent(page, "WKN:", "div");
	wkn && dc.put("wkn", wkn.getTextContent().trim().split(" ")[1]);
	
	isin = Packages.jsq.tools.HtmlUnitTools.getElementByPartContent(page, "ISIN:", "div");
	isin && dc.put("isin", isin.getTextContent().split(" ")[1]);

	name = Packages.jsq.tools.HtmlUnitTools.getFirstElementByXpath(page, "//h1");
	name && dc.put("name", name.getTextContent().trim());
	fetcher.setStockDetails(dc);
}

