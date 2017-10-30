const most = require("most");
const fetch = require("node-fetch");
const _ = require("lodash");

const fetchNodes = managerUrl => () =>
  fetch(`${managerUrl}/nodes`)
    .then(res => res.json())
    .then(nodes => nodes.map(node => node.Description.Hostname))
    .catch(reason => {
      console.error(
        `Error while trying to retrieve swarm nodes information from ${managerUrl}`,
        reason
      );
      return [];
    });

const fetchContainers = nodeIp =>
  fetch(
    `http://${nodeIp}:2375/containers/json?filters={"label":["bigboat.service.type=service"]}`
  )
    .then(res => res.json())
    .catch(reason => {
      console.error(
        `Error while trying to retrieve containers from node ${nodeIp}`,
        reason
      );
      return [];
    });

const fetchAllContainers = nodes => {
  const result = Promise.resolve([]);
  if (nodes && nodes.length) {
    const containers = nodes.map(node => fetchContainers(node));
    return Promise.all(containers).catch(reason => {
      console.error(
        `Error while trying to retrieve containers information`,
        reason
      );
      return [];
    });
  }
  return result;
};

const fetchServices = managerUrl =>
  fetch(
    `${managerUrl}/services?filters={"label":["bigboat.service.type=service"]}`
  )
    .then(res => res.json())
    .catch(reason => {
      console.error(
        `Error while trying to retrieve servcies from ${managerUrl}`,
        reason
      );
      return [];
    });

const fetchSwarmInfo = managerUrl => nodes =>
  Promise.all([fetchServices(managerUrl), fetchAllContainers(nodes)]);

module.exports = {
  watch: (mqtt, { managerUrl, networkName, scanInterval }) => {
    const nodes$ = most
      .periodic(scanInterval.nodes)
      .map(fetchNodes(managerUrl))
      .chain(most.fromPromise);

    const calcInstanceState = require("./instances")(networkName, managerUrl);
    most
      .combine(
        fetchSwarmInfo(managerUrl),
        nodes$,
        most.periodic(scanInterval.containers)
      )
      .chain(most.fromPromise)
      .observe(([services, containers]) => {
        let instances = {};
        if (containers) {
          const allContainers = _.flatten(containers);
          instances = calcInstanceState(services, allContainers);
        }
        mqtt.publish("/bigboat/instances", instances);
      });
  }
};
